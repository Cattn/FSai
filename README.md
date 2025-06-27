<h3 align="center">
    <strong>FSai</strong>
</h3>

FSi allows you to explore, organize, and learn more about your files with a simple, file-manager based layout, and a clean chat UI. Smooth & responsive animations, quick responses, and relavent tool calls to complete tasks. 

### Showcases

<p align="center">
    <img src="https://play.maple.music/SMS/uploads/Screenshot%202025-06-27%20170802.png" alt="FSai Screenshot">
</p>


<p align="center">
    <img src="https://play.maple.music/SMS/uploads/Screenshot%202025-06-27%20170908.png" alt="FSai Screenshot">
</p>

https://github.com/user-attachments/assets/d787f041-0c46-47c3-9009-e26657c06fb6

## Features
> Note: this isn't a comprehensive list of all "uses" of this app, simply the tools the agent has at the moment.

- Read files (Videos, Images, PDFs, Text Files)
- Write to files (Text)
- Create a directory
- Read the contents of a directory
- Get the tree of a directory
- Move files/folders to specified locations

The agent can also make use of a variety of these tools in combination to fufill more complex requests.

## Installation

Download a binary for your respective platform from the [Releases](https://github.com/Cattn/FSai/releases/latest) tab.


## Notes:
You need to provide your own Gemeni API key in settings. The free tier is acceptable for 90% of usage. 

This app should run perfectly fine on all platforms. If you encounter any issues, please create an [issue here](https://github.com/Cattn/FSai/issues/new)

## Development 

### Building & Dev server

1. Build the server
    - ``cd src-tauri/backend``
    - ``npm i``
    - ``npm run build-exe``
2. Build & Install tauri dependancies (from ./)
    - Install rust & cargo
    - ``npm i``
    - ``npm run tauri dev``
