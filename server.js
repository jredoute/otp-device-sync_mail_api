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
    const { from, email } = request.resourceURL.query

    if (!from) {
      request.reject(403, 'from query string must be specified')
      return
    }
    if (!email) {
      request.reject(403, 'email query string must be specified')
      return
    }
    try {
      const mailHostIndex = email.indexOf(`@${process.env.HOST}`)
    
      if (mailHostIndex === -1) {
        request.reject(403, `email must be of host ${process.env.HOST}`)
        return
      }
      
      const connection = request.accept('echo-protocol', request.origin)
      console.info(`Connection accepted for ${from} ${email} at ${(new Date())}`)
      
      connection.on('close', function(reasonCode, description) {
        console.info(`Peer ${connection.remoteAddress} disconnected at ${(new Date())}`)
      });
    
      connections.push({
        value: connection,
        from,
        user: email.substring(0, mailHostIndex)
      })
    } catch (e) {
      console.error(`error while creation ${from} ${email}`)
    }
  })
  
  chokidar.watch(baseMailPath, {
    ignoreInitial: true
  }).on('add', async (path) => {
    if (path.endsWith('.' + process.env.HOST) && path.indexOf('/Maildir/new') !== -1) {
      const file = fs.readFileSync(path)
  
      try {
        let parsed = await simpleParser(file.toString(), {skipImageLinks: true, skipTextLinks: true})

        const relatedConnections = connections.filter(c => {
          const matchingUser = path.startsWith(`${baseMailPath}/${c.user}/Maildir/new`)
          const matchingFrom = c.from === parsed.from.value[0].address
          return c.value.connected && matchingFrom && matchingUser
        })
        for (const c of relatedConnections) {
          try {
            let m = parsed.text.match(/^[0-9]{4,8}$/m)
            if (!m) {
              m = parsed.text.match(/^[0-9A-Z]{4,8}$/m)
            }
            if (!m) {
              m = parsed.text.match(/^[0-9A-Za-z]{4,8}$/m)
            }
            const code = m ? m[0] : null
            c.value.sendUTF(code);
            c.value.close(1000, 'Job done')
            afterSendCodeHook && afterSendCodeHook(code, c.from, c.user)

          } catch (e) {
            console.error(`error try matching ${path} with client socket: ${c.from} ${c.user}`, e)
          }
        }
      } catch (e) {
        console.error(`error parsing mail: ${path}`, e)
      }
    }
  });
}

export {
  launchServer
}