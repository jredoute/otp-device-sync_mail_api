import chokidar from 'chokidar';
import fs from 'fs'
import { simpleParser } from 'mailparser'
import WebSocketServer from 'websocket'
import http from 'http'
import 'dotenv/config'

if (!process.env.USERS_PATH) {
  throw new Error('USERS_PATH env variable is not defined')
}

if (!process.env.HOST) {
  throw new Error('HOST env variable is not defined')
}

if (!process.env.PORT) {
  throw new Error('PORT env variable is not defined')
}

const connections = []

const baseMailPath = `${process.env.USERS_PATH}`

const launchServer = function (afterSendCodeHook) {
  var server = http.createServer();

  server.listen(process.env.PORT, function() {
    console.log(`Server is listening on port ${process.env.PORT} as ${(new Date())}`);
  });
  
  const wsServer = new WebSocketServer.server({
    httpServer: server,
    // You should not use autoAcceptConnections for production
    // applications, as it defeats all standard cross-origin protection
    // facilities built into the protocol and the browser.  You should
    // *always* verify the connection's origin and decide whether or not
    // to accept it.
    autoAcceptConnections: false
  });
  
  wsServer.on('request', function(request) {
    const { from, email, all } = request.resourceURL.query

    if (!from) {
      request.reject(403, 'from query string must be specified')
      return
    }
    if (!email) {
      request.reject(403, 'email query string must be specified')
      return
    }

    const mailHostIndex = email.indexOf(`@${process.env.HOST}`)

    if (mailHostIndex === -1) {
      request.reject(403, `email must be of host ${process.env.HOST}`)
      return
    }

    const user = email.substring(0, mailHostIndex)

    const nb = connections.filter(c => {
      const matchingUser = c.user === user
      const matchingFrom = c.from === from
      return c.value.connected && matchingFrom && matchingUser
    }).length

    if (nb > 2) {
      request.reject(403, 'too many connections for this service-user pair')
      return
    }
  
    try {
      const connection = request.accept('echo-protocol', request.origin)
      console.info(`Connection accepted for ${from} ${email} at ${(new Date())}`)
      
      const timeout = setTimeout(() => {
        console.log('Timeout atteint, fermeture de la connexion.');
        connection.close(1000, 'Timeout')
      }, 5 * 60 * 1000);

      connection.on('close', function(reasonCode, description) {
        clearTimeout(timeout);
        console.info(`Peer ${connection.remoteAddress} disconnected at ${(new Date())}`)
      });

      connections.push({
        value: connection,
        from,
        user,
        all
      })
    } catch (e) {
      console.error(`error while creation ${from} ${email}`)
    }
  })

  const extractCodes = (text) => {
    const matches = text.match(/^(?:[0-9]{4,6}|[0-9A-Za-z]{6,8}|[a-fA-F0-9]{6,8})$/gm)
    return matches || [];
  };

  const extractLinks = (text) => {
    const urlPattern = /https?:\/\/[^\s]+/g;
    const links = text.match(urlPattern);
    return links || [];
  };
  
  chokidar.watch(baseMailPath, {
    ignoreInitial: true
  }).on('add', async (path) => {
    if (path.endsWith('.' + process.env.HOST) && path.indexOf('/Maildir/new') !== -1) {
      const file = fs.readFileSync(path)
  
      try {
        let { from, text, html } = await simpleParser(file.toString(), {skipImageLinks: true, skipTextLinks: true})

        console.info(`Mail recieved for ${from.value[0].address}, ${path}`)
        const relatedConnections = connections.filter(c => {
          const matchingUser = path.startsWith(`${baseMailPath}/${c.user}/Maildir/new`)
          const matchingFrom = c.from === from.value[0].address
          return c.value.connected && matchingFrom && matchingUser
        })

        if (!relatedConnections.length) {
          console.error(`No client waiting for ${from.value[0].address}, ${path}`)
          fs.unlinkSync(path)
          return
        }

        const codes = extractCodes(text)
        const links = extractLinks(text)

        for (let c of relatedConnections) {
          try {
            if (!codes) {
              console.error(`No code found for ${from.value[0].address}, ${path} in ${text}`)
              c.value.close(1000, 'No code found')
              fs.unlinkSync(path)
              return
            }
    
            c.value.sendUTF(JSON.stringify({
              codes,
              links,
              html
            }));
    
            c.value.close(1000, 'Job done')

            if (!c.all) {
              afterSendCodeHook && afterSendCodeHook(JSON.stringify({
                codes,
                links,
                html
              }), c.from, c.user)
            }
          } catch (e) {
            console.error(`error with ws client:`, e)
          }
        }
       
        fs.unlinkSync(path)
      } catch (e) {
        console.error(`error parsing mail: ${path}`)
      }      
    }
  })
}

export {
  launchServer
}