var Buffer = require('buffer').Buffer;
var randomstring = require("randomstring");
var http = require('http');
var zlib = require('zlib');
var Stream = require('stream')
var cluster = require('cluster')
var os = require('os')

var DEFAULT_PARETO_SHAPE = 7;
var DEFAULT_RESPONSE_LENGTH = 16;

/**
 * quantile (inverse cumulative density function) of the Pareto distribution
 * 
 * @param probability argument (0 < p < 1)
 * @param shape shape parameter (>0)
 * @param scale scale parameter (>0, "minimum income")
 *
 * @return icdf value
 */
 function _paretoQuantile (probability, shape, scale) {
   return scale / Math.pow (1.0-probability, 1.0/shape);
 }
 
 function randomParetoQuantile (shape, minimum) {
   return _paretoQuantile (Math.random(), shape, minimum);
 }

function requestHandler (req, res) {
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
  
  var dither = 0;
  if (query.dither_pareto_min) {
    var pareto_shape = query.dither_pareto_shape ? query.dither_pareto_shape : DEFAULT_PARETO_SHAPE;
    var pareto_min = query.dither_pareto_min;
    
    dither = Math.round (randomParetoQuantile (pareto_shape, pareto_min));
    headers['hcom.dither.function'] = "pareto: { min : "+pareto_min+", shape : "+pareto_shape+" }";
  } else if (query.dither) {
    dither = query.dither;
    headers['hcom.dither.function'] = "constant: "+dither+"ms";
  } else {
    headers['hcom.dither.function'] = "none";
  }
  headers['hcom.dither.ms'] = dither+"";
  
  var responseLength = DEFAULT_RESPONSE_LENGTH;
  if (query.response_pareto_min) {
    var pareto_shape = query.response_pareto_shape ? query.response_pareto_shape : DEFAULT_PARETO_SHAPE;
    var pareto_min = query.response_pareto_min;
    
    responseLength = Math.round (randomParetoQuantile (pareto_shape, pareto_min));
    headers['hcom.response.function'] = "pareto: { min : "+pareto_min+", shape : "+pareto_shape+" }";
  } else if (query.length) {
    responseLength = query.length;
    headers['hcom.response.function'] = "constant: "+responseLength;
  } else {
    headers['hcom.response.function'] = "none";
  }
  headers['hcom.response.length'] = responseLength+"";

  setTimeout(function (dither, length, isGzip, res) {
    res.writeHead(200, headers);
    
    var plain = randomstring.generate(length);
    
    if (isGzip) {
      zlib.gzip(plain, function (error,data) { this.end (data); }.bind(res));
    } else {
      res.end(plain);
    }
    
  }, dither, dither, responseLength, isGzip, res);
}

var port = process.argv[2]?parseInt(process.argv[2]):8081;
if (cluster.isMaster) {
  // Fork workers.
  for (var i = 0; i < os.cpus().length; i++) {
    cluster.fork();
  }
  console.log("Starting on " + port + " & forking a process for each of the " + os.cpus().length + " cores");
} else {
 http.createServer(requestHandler).listen(port);
 console.log("forked a process");
}
