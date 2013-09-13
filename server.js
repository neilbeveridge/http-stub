var Buffer = require('buffer').Buffer;
var randomstring = require("randomstring");
var http = require('http');
var zlib = require('zlib');
var Stream = require('stream')

http.createServer(function (req, res) {
  var url = require('url');
  var url_parts = url.parse(req.url, true);
  var query = url_parts.query;
 
  var acceptEncoding = req.headers['accept-encoding'];
  if (!acceptEncoding) {
    acceptEncoding = '';
  }
  var encodings = acceptEncoding.split(',');

  setTimeout(function(r, length, encodings, res){
    res.writeHead(200, { 'Content-Encoding': 'gzip', 'Content-Type': 'text/html; charset=UTF-8' });
    zlib.gzip(randomstring.generate(length?length:10), function(error,data){this.end(data);}.bind(res));
  }, query.dither?query.dither:0, res, query.length, encodings, res);
}).listen(80, '172.31.26.16');
console.log('Server running at http://172.31.26.16:80/');
