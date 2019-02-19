## Prerequisites

In order to run this project you need to have an account at https://www.twilio.com as well as a hosted phone number (to be used as the sender for all outgoing messages).

## Installation and Running Instructions

  * Install the project -> `npm i`
  * Build the project -> `npm run build`
  * Run the project -> `npm run start [Twillio Account ID] [Twillio Secret] [Twillio Number]`
  * Browse to `http://localhost:8080` and register using your name and phone number
  * Enjoy!
  
  Example:
  ```
  npm run start ACa4f85cd587cd3e64d75784c956ad05ec 464f42c18435010c77f5de975b44a283 +972541234567
  ```
  
## Background
The front end application is hosted within "*status.html*", you'll be forwarded to it following a sucessful registration.
The code is kept open and readable - use your browser's "view source" to dig into it.

The other significate part of this application is the API. It is CORS enabled (*) and requires a jwt token to be provided by the client for almost all endpoints.
