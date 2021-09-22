# marketui

_Just give me the damn books!_

![](https://raw.githubusercontent.com/xaur/marketui/media/media/v0.1.png)

`marketui` is a small web page to see Poloniex order books without clutter and slow load times.


## What works

- list of available markets and their prices
- order books for selected market
- manual or automatic updating of markets and books
- only HTTP API is used at the moment (book depth limited to 100 price levels, but this is already better than 50 levels shown in Polo's new UI)


## Roadmap

- update books via WebSockets API (full book depth, finally)
- show only favorite markets in the list
- user config
- show trade history
- show data from other exchanges
- more flexible UI widgets

This is a hobby project for quickly checking the markets and learn a bit of JavaScript/HTML/CSS along the way. There is no timeline.


## Installing

Method 1:

- download and unpack latest [zip of the master branch](https://github.com/xaur/marketui/archive/master.zip)

Method 2:

- clone this repo if you have [Git installed](https://git-scm.com/book/en/v2/Getting-Started-Installing-Git)
- this allows updating with a single `git pull` command (without re-downloading and re-extracting the zip)


## Usage

1\. Open `index.html` file in your browser:

- click `File` > `Open...` in the main menu (press `Alt` or `Alt+F` if you don't see the menu)
- or press `Ctrl-O`
- or type file path in the address bar
  - Linux users type something like `file:///home/user/path...`
  - Windows users type something like `file:///C:/path...`
- just find a way to open the file in your browser!

2\. Bookmark the file for quick access.

3\. Press `up markets` to load markets.

4\. Click any market in the list or click `up books` to load books.


## Contact

If you have any issue please submit it [here](https://github.com/xaur/marketui/issues). Please note this is a hobby experiment and I don't commit to anything at this stage.

If marketui was useful to you, feel free to tip me with a bit of DCR at DsefC8JBDkkyASdXrqA3HDzBByNhffLMjQS
