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
var PARAM_PAUSE_MS = "pause-%-ms";
var PARAM_PAUSE_CHANCE = "pause-%-chance";

var instance_pauses = {}

// DebugTracer prints traces to stdout
//tracers.pushTracer(new tracers.DebugTracer(process.stdout));

function guid() {
    function s4() {
        return Math.floor((1 + Math.random()) * 0x10000)
            .toString(16)
            .substring(1);
    }
    return s4() + s4() + '-' + s4() + '-' + s4() + '-' +
        s4() + '-' + s4() + s4() + s4();
}

function isPaused (name) {
    if (instance_pauses[name]) {
        return instance_pauses[name];
    }
    return false;
}

function shouldPause (query, startTime) {
    var i = 1;
    var name = query[PARAM_NAME];
    var pause;
    while (ms = query[PARAM_PAUSE_MS.replace('%', i)]) {
        var chance = query[PARAM_PAUSE_CHANCE.replace('%', i)];
        pause = _shouldPause(name, i, startTime, chance, ms);
        i++;
    }

    return pause;
}

function _shouldPause (name, index, time, chance, ms) {
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
        createPause(name, index, time, ms);
    }

    return false;
}

function createPause (name, index, start, ms) {
    var end = (+start) + (+ms);
    var pause = {
        name: name, start: +start, end: +end, ms: +ms, index: index
    };
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
    pause.guid = guid()
    //pause.identity = pause.start + ',' + pause.end;
    if (! instance_pauses[pause.name]) {
        instance_pauses[pause.name] = [];
        instance_pauses[pause.name].remains = _remainingGlobalFunction(instance_pauses[pause.name]);
        instance_pauses[pause.name].elapsedInRange = _totalElapsedPauseInTimeFunction(instance_pauses[pause.name]);
    }
    instance_pauses[pause.name].push(pause);

    // an attempt at memory management - remove pauses after the pause time has passed plus the maximum recorded dither
    // TODO: don't rely on max dither of all requests but instead max dither on the virtual origin
    setTimeout(function(){
        instance_pauses[pause.name].splice(instance_pauses[pause.name].indexOf(pause), 1)
    }, _maxDither + pause.ms)
}
function _remainingFunction (pause) {
    return function (now) { return now >= pause.end ? 0 : pause.end - now };
}
function _remainingGlobalFunction (pauses) {
    return function (now) {
        var remains = pauses.reduce(function(u,v){ return Math.max(u, v.remains(now)) }, 0);
        return remains;
    };
}
function _totalElapsedPauseInTimeFunction (pauses) {
    return function (from, to) {
        var pausesInRange = pauses.filter(function (pause) {
            return pause.start > from
        })
        if (pausesInRange.length > 0) {
            return _computeElapsedTimeFromRanges(pausesInRange);
        }
    };
}

function _computeElapsedTimeFromRanges (pauses) {
    if (pauses.length == 1) {
        return pauses[0].end - pauses[0].start;
    } else if (pauses.length == 0) {
        return 0;
    }

    // compute adjacency sorted by vertex edge count
    var adjacency = [];
    for (var i=0; i<pauses.length; i++) {
        // does anything overlap with this island?
        var edges = []
        for (var j=0; j<pauses.length; j++) {
            // not the same
            if (pauses[i].start != pauses[j].start && pauses[i].end != pauses[j].end) {
                if (_overlappingPauses(pauses[i], pauses[j])) {
                    edges.push([pauses[i], pauses[j]]);
                }
            }
        }
        if (edges.length > 0) adjacency.push(edges)
    }
    adjacency = adjacency.sort(function(a,b){return b.length-a.length});

    // find distinct edge adjacency optimising for largest vertex edge number
    var islands = [];
    var seen = [];
    for (var i=0; i<adjacency.length; i++) {
        // haven't seen this pause yet
        var vertexSeen = false;
        adjacency[i].map(function(edge){ if (seen.indexOf(edge[0].guid) != -1 || seen.indexOf(edge[1].guid) != -1) vertexSeen = true; })
        if (!vertexSeen) {
            adjacency[i].map(function(edge){ seen.push(edge[0].guid); seen.push(edge[1].guid); })
            islands.push(adjacency[i])
        }
    }

    // find difference between all pauses array and pauses appearing in the adjacency array to add vertices without edges
    islands = islands.concat(pauses.filter(function(pause){ return seen.indexOf(pause.guid) == -1 }).map(function(pause){ return [[pause, false]] }));

    // find the start and end of each island
    var spans = [];
    for (var i=0; i<islands.length; i++) {
        var island = [];
        for (var j=0; j<islands[i].length; j++) {
            island.push(islands[i][j][0])
            if (islands[i][j][1]) {
                island.push(islands[i][j][1])
            }
        }
        spans.push({start: island.reduce(function(u,v){ return Math.min(u, v.start) }, Infinity), end: island.reduce(function(u,v){ return Math.max(u, v.end) }, -Infinity)})
    }

    // sum the pause lengths of each island to give the total elapsed time
    return spans.map(function(span){ return span.end-span.start }).reduce(function(u,v){ return u+v })
}

function _overlappingPauses (p1, p2) {
    // not separate
    return ! (p1.end < p2.start || p1.start > p2.end);
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

    var pareto_min = query[prefix+'-pareto-min'] ? query[prefix+'-pareto-min'] : query[prefix+'_pareto_min'] ? query[prefix+'_pareto_min'] : false;
    var pareto_shape = query[prefix+'-pareto-shape'] ? query[prefix+'-pareto-shape'] : query[prefix+'_pareto_shape'] ? query[prefix+'_pareto_shape'] : false;

    if (pareto_min) {
        rtn.pareto = true;
        rtn.pareto_shape = pareto_shape ? pareto_shape : DEFAULT_PARETO_SHAPE;
        rtn.pareto_min = pareto_min;
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

var _maxDither = 0;
function registerDither(dither) {
    if (dither > _maxDither) {
        _maxDither = dither;
    }
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

    var pause = shouldPause(query, startTime);
    if (pause) {
        var remaining = pause.remains(startTime);
        //console.log(process.pid + " :: new request paused for : " + remaining + "ms")
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
    var respond = function(){sendResponse (metricNamespace, headers, request.start, payloadConfig.value, isGzip, res)};
    var doRespond = respond;

    // wait for dither
    if (dither>0) {
        registerDither(dither)

        setTimeout(function () {

            // do we need to add any additional latency where a pause started after the request start?
            var pause = isPaused(request.query[PARAM_NAME]);

            if (pause) {
                var elapsedPause = pause.elapsedInRange(request.start, Date.now());

                if (elapsedPause > 0) {
                    var timeSoFar = Date.now() - request.start;
                    var timeRequired = dither + elapsedPause;
                    var timeLeft = timeRequired - timeSoFar;

                    if (timeLeft > 0) {
                        doRespond = function () {
                            //console.log(process.pid + ' :: in-flight request paused for ' + timeLeft + "ms")
                            headers['stub.' + request.query[PARAM_NAME] + '.pause'] = timeLeft + (request.pause ? pause : 0);
                            setTimeout(respond, timeLeft)
                        }
                    }
                }
            }
            doRespond();
        }, dither);
    } else {
        doRespond();
    }

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
    process.send({type: MESSAGE_METRIC, name: namespace + '.' + name, value: value});
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
