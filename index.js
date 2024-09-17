import chokidar from 'chokidar';
import fs from 'fs'
import { simpleParser } from 'mailparser'
import WebSocketServer from 'websocket'
import http from 'http'


var server = http.createServer(function(request, response) {
    console.log((new Date()) + ' Received request for ' + request.url);
    response.writeHead(404);
    response.end();
});
server.listen(1234, function() {
    console.log((new Date()) + ' Server is listening on port 1234');
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


function originIsAllowed(origin) {
  // put logic here to detect whether the specified origin is allowed.
  return true;
}

let connection

wsServer.on('request', function(request) {
    // console.log(request.query.email)
    if (!originIsAllowed(request.origin)) {
      // Make sure we only accept requests from an allowed origin
      request.reject();
      console.log((new Date()) + ' Connection from origin ' + request.origin + ' rejected.');
      return;
    }
    
    connection = request.accept('echo-protocol', request.origin);
    console.log((new Date()) + ' Connection accepted.');
    


    connection.on('close', function(reasonCode, description) {
        console.log((new Date()) + ' Peer ' + connection.remoteAddress + ' disconnected.');
    });
});

chokidar.watch('../Maildir/new', {
  ignoreInitial: true,
  ignored: (file) => {
    if (file === '../Maildir/new') { return false }
    return !file.endsWith('.dylane.fr')
  }
}).on('add', async (path) => {
    const file = fs.readFileSync(path)

    let parsed = await simpleParser(file.toString())
    console.log(parsed.text.match(/[0-9]{4,8}/m)[0])
    console.log(parsed.from.value[0].address)
    connection?.sendUTF(parsed.text.match(/[0-9]{4,8}/m)[0]);
});
