---
title: Cryptocoin ticker
tagline: 20 June 2017
style: plain
---
# Cryptocoin ticker

![Pimoroni's microdot phat displaying Bitcoin program](https://clacktronics.co.uk/assets/microdot_bitcoin.jpg)
A Quick 5 minute build and possibly a prototype for a future project. I took the Pimoroni micro dot display, which is suitably retro looking, like an 80s/90s stock exchange. Although it is LED, it actually looks a bit like an old [Vacuum fluorescent display](https://en.wikipedia.org/wiki/Vacuum_fluorescent_display)! The code is a very simple Python script that uses Coinmarketcap API (I chose them because they pull all the coins together) which is simply just provided as JSON, the API allows you to request by currency so I just pulled the ones I wanted and fed the details into a single string that loops on the display.

See the python code below, it gets the details of the coins one by one and pulls the dollar value of them, concatenating it into a single string that is fed into the Pimoroni module for loading up text on the display. It only requests new information every 20 loops to lower demand on the API as it is probably request limited.

```python
from time import sleep
from microdotphat import write_string, scroll, clear, show
import json
import urllib2

# choose currencies to display
currencies = ['bitcoin', 'litecoin', 'dogecoin']

while True:
    ticker = ''

    for currency in currencies:

        url = "https://api.coinmarketcap.com/v1/ticker/%s/" % currency
        data = json.load(urllib2.urlopen(url))[0]

        ticker += '%s ' % data['symbol']
        ticker += '$%s ' % data['price_usd']

    for i in range(20):
        clear()
        write_string(ticker, kerning=False)
        for c in ticker:
            show()
            scroll(amount_x=8)
            sleep(.5)

    sleep(10)
```

Here is a Demo of it working, it can simply be run at startup ensuring there is an internet connection.

@[youtube](https://www.youtube.com/watch?v=wlej3YBEKBU)

