# Simple HTTP Stub
Launches a process per-core to process HTTP requests on the given port, binding to all interfaces by default.

- By setting 'dither' (time to wait before replying in ms) and 'length' (length of the response in bytes) parameters, the behaviour of the stub can be changed per-request. 
- IO and dither is asynchronous.
- The response will be GZIP'd if the accept-encoding request header contains 'gzip'.

## Run 
```
node server.js ${port}
```

## Use
```
http://localhost:${port}?dither=${dither-ms}&length=${length-bytes}
```
