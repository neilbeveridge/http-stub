var Buffer = require('buffer').Buffer;
var randomstring = require("randomstring");
var http = require('http');
var zlib = require('zlib');
var Stream = require('stream')
var cluster = require('cluster')
var os = require('os')
var metrics = require('metrics');

/*var trace = require('..').trace;
var tracers = require('..').tracers;*/

var DEFAULT_PARETO_SHAPE = 7;
var DEFAULT_RESPONSE_LENGTH = 16;
var DEFAULT_DITHER_MS = 0;
var DEFAULT_METRICS_PORT = 9091;
var DEFAULT_SERVER_PORT = 8081;
var METRICS_EXPONENTIAL_DECAY = 10000;

var MESSAGE_PAUSE_NOTIFY = 'pause-notify';
var MESSAGE_PAUSE_CREATE = 'pause-create';
var MESSAGE_METRIC = 'metric';

var PARAM_NAME = "name";
var PARAM_PAUSE_MS = "pause-ms";
var PARAM_PAUSE_CHANCE = "pause-chance";

var instance_pauses = {}

// DebugTracer prints traces to stdout
//tracers.pushTracer(new tracers.DebugTracer(process.stdout));

function isPaused (name) {
    if (instance_pauses[name]) {
        return instance_pauses[name];
    }
    return false;
}

function shouldPause (name, time, chance, ms) {
    if (! name) {
        return false;
    }

    if (instance_pauses[name]) { // has been a pause before
        if (instance_pauses[name].remains(time) > 0) { // paused
            return instance_pauses[name];
        }
    }

    // should a new pause occur?
    if (Math.random() <= chance) { // yes
        return createPause(name, time, ms);
    }

    return false;
}

function createPause (name, start, ms) {
    var end = (+start) + (+ms);
    var pause = {
        name: name, start: +start, end: +end, ms: +ms
    };
    pause.remains = _remainingFunction(pause);
    _pauseCreate (pause);
    return pause;
}

function _pauseCreate (pause) {
    var msg = {type: MESSAGE_PAUSE_CREATE, sender: process.pid, origin: process.pid, pause: pause};
    process.send (msg)
}
function _pauseBroadcast (workers, msg) {
    workers.map (function(worker) {
        worker.send ({type: MESSAGE_PAUSE_NOTIFY, sender: process.pid, origin: msg.sender, pause: msg.pause})
    });
}
function _pauseRecordLocal (msg) {
    //console.log(process.pid + ' :: received pause notification from ' + msg.origin)
    var pause = msg.pause;
    pause.remains = _remainingFunction(pause);
    instance_pauses[pause.name] = pause;
}
function _remainingFunction (pause) {
    return function (now) { return now >= pause.end ? 0 : pause.end - now }
}

/**
 * quantile (inverse cumulative density function) of the Pareto distribution
 *
 * @param probability argument (0 < p < 1)
 * @param shape shape parameter (>0)
 * @param scale scale parameter (>0)
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
    return 'dither-' + serialiseStubConfig (latencyConfig) + '-magnitude-' + serialiseStubConfig (payloadConfig);
}

function requestHandler (req, res) {
    /*var t = new trace.Trace('stub');
    t.record(trace.Annotation.serverRecv());*/

    if (req.url == "/favicon.ico") {
        res.writeHead(404, {});
        res.end();
        return;
    }

    var url = require('url');
    var url_parts = url.parse(req.url, true);
    var query = url_parts.query;

    var startTime = Date.now();

    var proceed = function (pause) { processRequest( { query: query, headers: req.headers, start: startTime, path: req.url, pause: pause }, res) };

    var pause = shouldPause(query[PARAM_NAME], startTime, query[PARAM_PAUSE_CHANCE], query[PARAM_PAUSE_MS]);
    if (pause) {
        var remaining = pause.remains(startTime);
        console.log(process.pid + " :: new request paused for : " + remaining + "ms")
        setTimeout(proceed.bind(this, remaining), remaining);
    } else {
        proceed();
    }
}

function processRequest (request, res) {
    var acceptEncoding = request.headers['accept-encoding'];
    if (!acceptEncoding) {
        acceptEncoding = '';
    }

    var isGzip = acceptEncoding.indexOf('gzip')>-1;
    var headers = {'Content-Type': 'text/html; charset=UTF-8'};
    if (isGzip) {
        headers['Content-Encoding'] = 'gzip';
    }

    var latencyConfig = toStubConfig (request.query, 'dither', DEFAULT_DITHER_MS);
    if (latencyConfig.pareto) {
        headers['stub.dither.function'] = "pareto: { min : "+latencyConfig.pareto_min+", shape : "+latencyConfig.pareto_shape+" }";
    } else if (latencyConfig.constant) {
        headers['stub.dither.function'] = "constant: "+latencyConfig.value+"ms";
    } else {
        headers['stub.dither.function'] = "none";
    }
    headers['stub.dither.ms'] = latencyConfig.value+"";

    var payloadConfig = toStubConfig (request.query, 'magnitude', DEFAULT_RESPONSE_LENGTH);
    if (payloadConfig.pareto) {
        headers['stub.magnitude.function'] = "pareto: { min : "+payloadConfig.pareto_min+", shape : "+payloadConfig.pareto_shape+" }";
    } else if (payloadConfig.constant) {
        headers['stub.magnitude.function'] = "constant: "+payloadConfig.value;
    } else {
        headers['stub.magnitude.function'] = "none";
    }
    headers['stub.magnitude.length'] = payloadConfig.value+"";

    if (request.pause) {
        headers['stub.' + request.query[PARAM_NAME] + '.pause'] = request.pause;
    }

    var dither = latencyConfig.value;

    var metricNamespace = toMetricNamespace(latencyConfig, payloadConfig);

    // wait for dither
    setTimeout(function(){
        var respond = function(){sendResponse (metricNamespace, headers, request.start, payloadConfig.value, isGzip, res)};
        var doRespond = respond;

        // do we need to add any additional latency where a pause started after the request start?
        var pause = isPaused(request.query[PARAM_NAME]);
        if (pause) {
            // this pause started after the request began so we need to account for it
            if (pause.start > request.start) {
                var timeSoFar = Date.now() - request.start;
                var timeRequired = dither + pause.ms;
                var timeLeft = timeRequired - timeSoFar;

                if (timeLeft > 0) {
                    doRespond = function () {
                        console.log(process.pid + ' :: in-flight request paused for ' + timeLeft + "ms")
                        headers['stub.' + request.query[PARAM_NAME] + '.pause'] = timeLeft + (request.pause ? pause : 0);
                        setTimeout(respond, timeLeft)
                    }
                }
            }
        }
        doRespond();
    }, dither);

}

function sendResponse (metricNamespace, headers, startTime, length, isGzip, res) {

    var plain = randomstring.generate(length);
    var opFn;

    if (isGzip) {

        zlib.gzip(plain, function (error, data) {

            res.writeHead(200, headers);
            res.end(data);
            updateHistogram(metricNamespace, 'servicetime', (new Date()).getTime() - startTime);
            updateHistogram(metricNamespace, 'magnitude', length);

        });

    } else {

        res.end(plain);
        updateHistogram(metricNamespace, 'servicetime', (new Date()).getTime() - startTime);
        updateHistogram(metricNamespace, 'magnitude', length);

    }

}

function updateHistogram (namespace, name, value) {
    // Send message to master process.
    process.send({type: 'metric', name: namespace + '.' + name, value: value});
}

var stubPort = process.argv[2]?parseInt(process.argv[2]):DEFAULT_SERVER_PORT;
var metricsPort = process.argv[3]?parseInt(process.argv[3]):DEFAULT_METRICS_PORT;
var histograms = {}

if (cluster.isMaster) {
    var metricsServer = new metrics.Server(metricsPort);
    var workers = []

    // Fork workers.
    for (var i = 0; i < os.cpus().length; i++) {
        var worker = cluster.fork();
        workers.push(worker)

        // receive messages from the worker process in the master process
        worker.on('message', function(msg) {
            switch (msg.type) {
                case MESSAGE_METRIC:
                    if (!histograms[msg.name]) {
                        histograms[msg.name] = Histogram.createExponentialDecayHistogram(METRICS_EXPONENTIAL_DECAY);
                        metricsServer.addMetric(msg.name, histograms[msg.name]);
                    }
                    histograms[msg.name].update(msg.value);
                    break;
                case MESSAGE_PAUSE_CREATE:
                    _pauseBroadcast(workers, msg)
                    break;
            }
        });


    }

    console.log('Stub server master process ' + process.pid + ' starting.');
    console.log('Starting http stub:\t' + stubPort);
    console.log('Starting http metrics:\t' + metricsPort);
    console.log('Spawning an event loop worker for each of '+os.cpus().length+' cores');
} else {
    http.createServer(requestHandler).listen(stubPort);
    console.log('Worker ' + process.pid + ' has started\t[OK]');

    process.on ('message', function(msg){
        switch (msg.type) {
            case MESSAGE_PAUSE_NOTIFY:
                _pauseRecordLocal(msg);
                break;
        }
    });
}
