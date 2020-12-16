TCP Test server
===============

This small app implements controllable TCP server for testing connection failures.
Behavior is controlled by request text. Server executes actions defined in request
or in command line parameter over the client socket.

Format of actions list
----------------------

Request must contain action set:

`ACT["set"]`

`set ::= "" | action[=param][,action[=param]]...`

After executing all actions connection is left active.
If `set` is empty, server just does nothing with the connection

`action`:

- `CLOSE` - close connection
- `DATA=length` - write `length` of random data
- `SEND=resp` - write `resp` string (URL-encoding is supported)
- `WAIT=time` - wait for `time` msecs
- `SHUT` - stop the server from listening (won't close active connections)

Any combination and order of actions is allowed.

Request could contain any other characters besides action set:

```
GET /ACT[SEND=HTTP/1.1 200 OK%0D%0A%0D%0A] HTTP/1.1
Host: localhost
...
```

or even

```
GET /foo HTTP/1.1
Host: localhost
X-Act: ACT[SEND=HTTP/1.1 200 OK%0D%0A%0D%0A]
...
```

Example
-------

Connect to server and send following text:

```
ACT[SEND=Hello!%0D%0A,DATA=1000,WAIT=1000,CLOSE]
```

Server will respond with `Hello!\r\n`, 1000 bytes of random data, then wait for 1000 msecs and then close connection.

Command line arguments
----------------------

`>node <scriptname.js> [port] [actionset]`

- `-?`, `-h`, `/?` - print usage and exit
- `port` - port number to listen. Default is `11111`
- `actionset` - global set or actions for all clients
