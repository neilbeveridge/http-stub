var Buffer = require('buffer').Buffer;
var randomstring = require("randomstring");
var http = require('http');
var zlib = require('zlib');
var Stream = require('stream')
var cluster = require('cluster')
var os = require('os')
var metrics = require('metrics');

var DEFAULT_PARETO_SHAPE = 7;
var DEFAULT_RESPONSE_LENGTH = 16;
var DEFAULT_DITHER_MS = 0;
var DEFAULT_METRICS_PORT = 9091;
var DEFAULT_SERVER_PORT = 8081;
var METRICS_EXPONENTIAL_DECAY = 10000;

/**
 * quantile (inverse cumulative density function) of the Pareto distribution
 * 
 * @param probability argument (0 < p < 1)
 * @param shape shape parameter (>0)
 * @param scale scale parameter (>0, "minimum")
 *
 * @return icdf value
 */
 function _paretoQuantile (probability, shape, scale) {
   return scale / Math.pow (1.0-probability, 1.0/shape);
 }
 
 function randomParetoQuantile (shape, minimum) {
   return _paretoQuantile (Math.random(), shape, minimum);
 }

 function toStubConfig (query, prefix, defaultValue) {
     var rtn = {};
     rtn.pareto = rtn.constant = false;
     rtn.value = defaultValue;

     if (query[prefix+'_pareto_min']) {
         rtn.pareto = true;
         rtn.pareto_shape = query[prefix+'_pareto_shape'] ? query[prefix+'_pareto_shape'] : DEFAULT_PARETO_SHAPE;
         rtn.pareto_min = query[prefix+'_pareto_min'];
         rtn.value = Math.round (randomParetoQuantile (rtn.pareto_shape, rtn.pareto_min));
     } else if (query[prefix]) {
         rtn.constant = true;
         rtn.value = query[prefix];
     }

     return rtn;
 }

 function serialiseStubConfig (stubConfig) {
     return (stubConfig.pareto ? ('pareto-'+stubConfig.pareto_shape+'-'+stubConfig.pareto_min) : stubConfig.value);
 }

 function toMetricNamespace (latencyConfig, payloadConfig) {
     return 'latency-' + serialiseStubConfig (latencyConfig) + '-payload-' + serialiseStubConfig (payloadConfig);
 }


function requestHandler (req, res) {
  var startTime = (new Date()).getTime();

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

  var latencyConfig = toStubConfig (query, 'dither', DEFAULT_DITHER_MS);
  if (latencyConfig.pareto) {
    headers['stub.dither.function'] = "pareto: { min : "+latencyConfig.pareto_min+", shape : "+latencyConfig.pareto_shape+" }";
  } else if (latencyConfig.constant) {
    headers['stub.dither.function'] = "constant: "+latencyConfig.value+"ms";
  } else {
    headers['stub.dither.function'] = "none";
  }
  headers['stub.dither.ms'] = latencyConfig.value+"";
  
  var payloadConfig = toStubConfig (query, 'magnitude', DEFAULT_RESPONSE_LENGTH);
  if (payloadConfig.pareto) {
    headers['stub.response.function'] = "pareto: { min : "+payloadConfig.pareto_min+", shape : "+payloadConfig.pareto_shape+" }";
  } else if (payloadConfig.constant) {
    headers['stub.response.function'] = "constant: "+payloadConfig.value;
  } else {
    headers['stub.response.function'] = "none";
  }
  headers['stub.response.length'] = payloadConfig.value+"";

  setTimeout(function (dither, length, isGzip, res) {
    res.writeHead(200, headers);

    var plain = randomstring.generate(length);
    var metricNamespace = toMetricNamespace(latencyConfig, payloadConfig);
    
    if (isGzip) {
      zlib.gzip(plain, function (error,data) {
        this.end (data);
        updateHistogram(metricNamespace, 'dither', (new Date()).getTime() - startTime);
        updateHistogram(metricNamespace, 'magnitude', length);
      }.bind(res));
    } else {
      res.end(plain);
      updateHistogram(metricNamespace, 'dither', (new Date()).getTime() - startTime);
      updateHistogram(metricNamespace, 'magnitude', length);
    }
    
  }, latencyConfig.value, latencyConfig.value, payloadConfig.value, isGzip, res);

}

function updateHistogram (namespace, name, value) {
  // Send message to master process.
  process.send({name: namespace + '.' + name, value: value});
}

var stubPort = process.argv[2]?parseInt(process.argv[2]):DEFAULT_SERVER_PORT;
var metricsPort = process.argv[3]?parseInt(process.argv[3]):DEFAULT_METRICS_PORT;
var histograms = {}

if (cluster.isMaster) {
  var metricsServer = new metrics.Server(metricsPort);

  // Fork workers.
  for (var i = 0; i < os.cpus().length; i++) {
    var worker = cluster.fork();

    // receive messages from the worker process in the master process
    worker.on('message', function(msg) {
        if (! histograms[msg.name]) {
            histograms[msg.name] = Histogram.createExponentialDecayHistogram(METRICS_EXPONENTIAL_DECAY);
            metricsServer.addMetric(msg.name, histograms[msg.name]);
        }
        histograms[msg.name].update(msg.value);
    });
  }

  console.log('Stub server master process ' + process.pid + ' starting.');
  console.log('Starting http stub:\t' + stubPort);
  console.log('Starting http metrics\t' + metricsPort);
  console.log('Spawning an event loop worker for each of '+os.cpus().length+' cores');
} else {
 http.createServer(requestHandler).listen(stubPort);
 console.log('Worker ' + process.pid + ' has started.');
}
