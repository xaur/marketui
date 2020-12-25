# marketui

_just show me the damn books!_

![](https://raw.githubusercontent.com/xaur/marketui/media/media/v0.1.png)

This project provides a minimalistic web page to see Poloniex order books.

### What works

- show/update a list of markets and their prices
- show/update market's order books (up to 100 price levels)
- currently the update mode is manual (click to update)

### Next tasks

- automatic update of books via HTTP API (100 rows limit)
- automatic update of markets
- automatic update of books via WebSockets (unlimited book depth, finally)

This is a hobby project to see order books at minimum cost and learn a bit of javascript/HTML/CSS in the process. There is no timeline.

### Installation

Option 1:

- download and unpack latest [zip of the master branch](https://github.com/xaur/marketui/archive/master.zip)

Option 2:

- clone this repo is you have [Git installed](https://git-scm.com/book/en/v2/Getting-Started-Installing-Git)
- this allows updating with a single `git pull` command

### Usage

1\. Open the `index.html` file in your browser:

- click `File` > `Open...` in the main menu (press `Alt` or `Alt+F` if you don't see the menu)
- or press `Ctrl-O`
- or type the file path in the address bar
  - Linux users type something like `file:///home/user/path...`
  - Windows users type something like `file:///C:/path...`
- just find a way to open the file in the browser!

2\. Bookmark the file for quick access.

3\. Press `up markets` to load markets.

4\. Click any market in the list or click `up books` to load books.

### Contact

If you have any issue please submit it [here](https://github.com/xaur/marketui/issues). Please note this is a hobby experiment and I don't commit to anything at this stage.

If marketui was useful to you, feel free to tip me with a bit of DCR at DsefC8JBDkkyASdXrqA3HDzBByNhffLMjQS
