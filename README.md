# Simple HTTP Stub
Launches a process per-core to process HTTP requests on the given port, binding to all interfaces by default.

- The behaviour of the stub can be changed per-request by setting HTTP Request parameters.
- IO and dither is asynchronous.
- Supports arbitrarily many non-deterministic pauses asynchronously for independent virtual origins.
- The response will be GZIP'd if the accept-encoding request header contains 'gzip'.
- Provides Coda Hale Metrics Histogram port data over HTTP for dither and payload magnitude observed by the server.

## Run 
```
node server.js ${stub-port} ${metrics-port}
```

## Use

http-stub provides two different algorithms for determining response length and latency:

- Constant
 - Set a constant length in bytes for the response.
 - Set a constant dither latency in milliseconds.
- Pareto Distribution (thick-tail)
 - Majority of requests occur close to the minimum which is configured but there is a long tail allowing modelling of realistic conditions.
 - Set a minimum value for the length of the response in bytes and the dither latency in milliseconds.
 - Set an integer reflecting the shape of the distribution e.g. 1 is a very thick tail and 7 is thick. Defaults to 7.

### Constant Latency & Response Length

Respond as quickly as possible with a constant 5000B response payload:
```
http://localhost:8081/?magnitude=5000
```

Notice the response headers indicating the dither and response length profile used:
```
stub.dither.function: none
stub.dither.ms: 0
stub.magnitude.function: constant: 5000
stub.magnitude.length: 5000
```

Respond after the specified dither latency:
```
http://localhost:8081/?dither=350&magnitude=5000

stub.dither.function :constant: 350ms
stub.dither.ms: 350
stub.magnitude.function: constant: 5000
stub.magnitude.length: 5000
```

### Variable Latency & Response Length

Respond as quickly as possible with a Pareto-distributed response payload length, starting at 5000B:
```
http://localhost:8081/?magnitude-pareto-min=5000

stub.dither.function: none
stub.dither.ms: 0
stub.magnitude.function: pareto: { min : 5000, shape : 7 }
stub.magnitude.length: 5713
```

Respond as quickly as possible with a Pareto-distributed response payload length, starting at 5000B with a narrow tail:
```
http://localhost:8081/?magnitude-pareto-min=5000&magnitude-pareto-shape=15

stub.dither.function: none
stub.dither.ms: 0
stub.magnitude.function: pareto: { min : 5000, shape : 15 }
stub.magnitude.length: 5092
```

Respond with a 250ms minimum latency, governed by a thick tail Pareto Distribution with a Pareto-distributed response payload length, starting at 5000B with a narrow tail:
```
http://localhost:8081/?magnitude-pareto-min=5000&magnitude-pareto-shape=15&dither-pareto-min=250

stub.dither.function: pareto: { min : 250, shape : 7 }
stub.dither.ms: 256
stub.magnitude.function: pareto: { min : 5000, shape : 15 }
stub.magnitude.length: 5127

Indicative Latency Distribution
  50%  275.88ms
  75%  312.95ms
  90%  368.47ms
  99%  536.04ms
```

Respond with a 250ms minimum latency, governed by a very thick tail Pareto Distribution with a Pareto-distributed response payload length, starting at 5000B with a narrow tail:
```
http://localhost:8081/?magnitude-pareto-min=5000&magnitude-pareto-shape=15&dither-pareto-min=250&dither-pareto-shape=2

stub.dither.function: pareto: { min : 250, shape : 2 }
stub.dither.ms: 507
stub.magnitude.function: pareto: { min : 5000, shape : 15 }
stub.magnitude.length: 5574

Indicative Latency Distribution
  50%  370.09ms
  75%  647.80ms
  90%    1.50s 
  99%    3.60s
```

### Adding Pauses
- Supports creation of distinct virtual origins, each of which can be configured with a number of pause behaviours.
- Pauses may overlap.
- When a pause occurs in a virtual origin, all other requests arriving or in-flight to that virtual origin are suspended during the pause.
- May be combined with dither and payload settings as normal.

Add a 30ms pause with a 0.1% chance of occurring.
```
http://localhost:8081/?name=origin-foo&pause-1-ms=30&pause-1-chance=0.001
```

Add an additional pause occurring less often but for longer, simulating a compacting GC.
```
http://localhost:8081/?name=origin-foo&pause-1-ms=30&pause-1-chance=0.001&pause-2-ms=5000&pause-2-chance=0.000001
```

### Accessing Histogram Metrics over HTTP
JSON Histogram metrics are provided as JSON over HTTP for Dither and Magnitude. A Histogram is created for each distinct set of query parameters which yield a logically different behaviour. For example, a request for the same Pareto Dither Distribution will always be reported in Histogram A, whilst a request for a Constant Dither 50ms will always be reported in Histogram B, with its 50ms brothers.
```
http://localhost:9091/metrics

{
    dither-pareto-7-1000-magnitude-pareto-7-500: {
        dither: {
            type: "histogram",
            min: 1757,
            max: 1757,
            sum: 1757,
            variance: null,
            mean: 1757,
            std_dev: null,
            count: 1,
            median: 1757,
            p75: 1757,
            p95: 1757,
            p99: 1757,
            p999: 1757
        },
        magnitude: {
            type: "histogram",
            min: 502,
            max: 502,
            sum: 502,
            variance: null,
            mean: 502,
            std_dev: null,
            count: 1,
            median: 502,
            p75: 502,
            p95: 502,
            p99: 502,
            p999: 502
        }
    },
    dither-0-magnitude-16: {
        dither: {
            type: "histogram",
            min: 4,
            max: 4,
            sum: 4,
            variance: null,
            mean: 4,
            std_dev: null,
            count: 1,
            median: 4,
            p75: 4,
            p95: 4,
            p99: 4,
            p999: 4
            },
        magnitude: {
            type: "histogram",
            min: 16,
            max: 16,
            sum: 16,
            variance: null,
            mean: 16,
            std_dev: null,
            count: 1,
            median: 16,
            p75: 16,
            p95: 16,
            p99: 16,
            p999: 16
        }
    }
}
```
