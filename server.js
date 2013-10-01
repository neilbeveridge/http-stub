var Buffer = require('buffer').Buffer;
var randomstring = require("randomstring");
var http = require('http');
var zlib = require('zlib');
var Stream = require('stream')
var cluster = require('cluster')
var os = require('os')

if (cluster.isMaster) {
  // Fork workers.
  for (var i = 0; i < os.cpus().length; i++) {
    cluster.fork();
  }
  console.log('Server running at http://172.31.17.237:80/');
} else {
  http.createServer(function (req, res) {
    var url = require('url');
    var url_parts = url.parse(req.url, true);
    var query = url_parts.query;

    var acceptEncoding = req.headers['accept-encoding'];
    if (!acceptEncoding) {
      acceptEncoding = '';
    }

    var isGzip = acceptEncoding.indexOf('gzip')>-1;
    var headers = {'Content-Type': 'text/html; charset=UTF-8'};
    if (isGzip) {
      headers['Content-Encoding'] = 'gzip';
    }


    setTimeout(function(length, isGzip, res){
      res.writeHead(200, headers);
      var plain = randomstring.generate(length?length:10);
      if (isGzip) {
        zlib.gzip(plain, function(error,data){this.end(data);}.bind(res));
      } else {
        res.end(plain);
      }
    }, query.dither?query.dither:0, query.length, isGzip, res);
  }).listen(80, '172.31.17.237');
  console.log('Forking process for core');
}
