var randomstring = require("randomstring");
var http = require('http');
http.createServer(function (req, res) {
  res.writeHead(200, {'Content-Type': 'text/plain'});
  var url = require('url');
  var url_parts = url.parse(req.url, true);
  var query = url_parts.query;
  setTimeout(function(r,length){r.end(randomstring.generate(length?length:10));}, query.dither?query.dither:0, res, query.length);
//  res.end('Hello World\n');
}).listen(1337, '172.31.17.10');
console.log('Server running at http://172.31.17.10:1337/');
