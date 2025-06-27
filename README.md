<h3 align="center">
    <strong>FSai</strong>
</h3>

### Showcases

<p align="center">
    <img src="https://play.maple.music/SMS/uploads/Screenshot%202025-06-27%20170802.png" alt="FSai Screenshot">
</p>


<p align="center">
    <img src="https://play.maple.music/SMS/uploads/Screenshot%202025-06-27%20170908.png" alt="FSai Screenshot">
</p>


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