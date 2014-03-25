# Simple HTTP Stub
Launches a process per-core to process HTTP requests on the given port, binding to all interfaces by default.

- The behaviour of the stub can be changed per-request by setting HTTP Request parameters.
- IO and dither is asynchronous.
- The response will be GZIP'd if the accept-encoding request header contains 'gzip'.

## Run 
```
node server.js ${port}
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
http://localhost:8081?length=5000
```

Notice the response headers indicating the dither and response length profile used:
```
stub.dither.function: none
stub.dither.ms: 0
stub.response.function: constant: 5000
stub.response.length: 5000
```

Respond after the specified dither latency:
```
http://localhost:8081?dither=350&length=5000
```

Notice the response headers indicating the dither and response length profile used:
```
stub.dither.function :constant: 350ms
stub.dither.ms: 350
stub.response.function: constant: 5000
stub.response.length: 5000
```

### Variable Latency & Response Length

Respond as quickly as possible with a Pareto-distributed response payload length, starting at 5000B:
```
http://localhost:8081?response_pareto_min=5000
```

Notice the response headers indicating the dither and response length profile used:
```
stub.dither.function: none
stub.dither.ms: 0
stub.response.function: pareto: { min : 5000, shape : 7 }
stub.response.length: 5713
```

Respond as quickly as possible with a Pareto-distributed response payload length, starting at 5000B with a narrow tail:
```
http://localhost:8081?response_pareto_min=5000&response_pareto_shape=15
```

Notice the response headers indicating the dither and response length profile used:
```
stub.dither.function: none
stub.dither.ms: 0
stub.response.function: pareto: { min : 5000, shape : 15 }
stub.response.length: 5092
```

Respond with a 250ms minimum latency, governed by a thick tail Pareto Distribution with a Pareto-distributed response payload length, starting at 5000B with a narrow tail:
```
http://localhost:8081?response_pareto_min=5000&response_pareto_shape=15&dither_pareto_min=250
```

Notice the response headers indicating the dither and response length profile used:
```
stub.dither.function: pareto: { min : 250, shape : 7 }
stub.dither.ms: 256
stub.response.function: pareto: { min : 5000, shape : 15 }
stub.response.length: 5127
```

Respond with a 250ms minimum latency, governed by a very thick tail Pareto Distribution with a Pareto-distributed response payload length, starting at 5000B with a narrow tail:
```
http://localhost:8081?response_pareto_min=5000&response_pareto_shape=15&dither_pareto_min=250&dither_pareto_shape=2
```

Notice the response headers indicating the dither and response length profile used:
```
stub.dither.function: pareto: { min : 250, shape : 2 }
stub.dither.ms: 507
stub.response.function: pareto: { min : 5000, shape : 15 }
stub.response.length: 5574
```
