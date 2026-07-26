---
title: Blog
tagline: Posts 1–5 of 44
style: plain
---
# Blog

[Blog list](window:file/blog-list.md)
[Older posts >](window:file/blog-page-2.md)

Page 1 of 9

---

## EuroClack - Mini Speaker

`09 August 2019` · [Open this post on its own](window:file/blog/2019-08-09-euroclack.md)

I am back to producing audio equipment! There is a new section under "Reasearch" called EuroClack, it is for synth DIY and I am producing and selling full kits / designing open source modules. The first full kit is a mini-speaker that fits into 6HP, see more inforation on [the page](https://clacktronics.co.uk/euroclack/).

---

## Flip dots with Python

`03 January 2019` · [Open this post on its own](window:file/blog/2019-01-03-flipdots.md)

@[video](https://clacktronics.co.uk/assets/flipdots.mp4 "Flipdots Flippin")

I have been working on a project for an artist that uses flip dot display panels. Flip dot/disc displays are a [bygone technology](https://en.wikipedia.org/wiki/Flip-disc_display) that were typically used in places such as airports and stock exchanges, anywhere there was a need for dynamically displayed information. They were great for power efficiency as they retain their image with the power removed, therefore would have been much less power hungry than the light based displays of the time. Now superseded by LED displays that are just as efficient, but need less maintenance, they are still manufactured by *Alfa-Zeta* and used for more creative / nostalgic purposes. For this work I needed to create a program to show images on the panels, initially I was unsure of the source of the images, could it be a video? or programatically generated? So I decided to go as high level as possible and use Python on a Raspberry Pi. That way I would not have to re-write the program every time the ideas or the dimensions changed. I thought it would be great to be able to use *Python Imaging Library* [pillow fork](https://github.com/python-pillow/Pillow) to manipulate the dots, that way I could draw shapes and text trivially, plus if any changes were needed I could write them quickly on the fly. I came up with [FliPIL](https://github.com/clacktronics/flipPIL)  a sort of wrapper between PIL and the flip dot's protocol.

*Alfa-Zeta* sell the flip dots in controllable panel modules, the larger one is made up of of two [7x28 sections](https://flipdots.com/en/products-services/flip-dot-boards-xy5/) which is the type I used. Each 7x28 section has an ATMEGA micro-controller that receives messages over RS485 interface. The way you address each panel is by setting it in binary on a DIP switch connected to its microcontroller. The protocol to then control the panel is quite simple, you send a series of bytes, the first few bytes being meta information like address of the panel then there is a series of 28 bytes each representing a column (or row depending on your perspective) of 7 dots. So for example if I wanted the second row to be `0010011` I would send a byte for the first column then another with the value 19 (the last bit being ignored).

To make a display you have to tile the flip dot panels and set the addresses. I designed the wrapper class to make a PIL Image object that is the same width and height as the desired display then translate that image into the command for the flip dot display. To tell my program what the panel is like you have to define the layout using a two-dimensional array ('list' in python), this has to be done otherwise there is no-knowing the physical location of all the flip dot modules.

```python
panel1 = flipil("alfa_zeta", [28, 7], [[1,2],[3,4],[5,6]])
```
The wrapper is all set up as a class, you have to initiate the panel as an object with the above line. The first two arguments are so I could possibly add different types of flip dot modules in the future. The third is the one that defines the layouts, each list within the list represents a row and each entry in each inner list represents a column, the numbers are the panel module addresses. So the above would be interpreted as the following.

```
1 2
3 4
5 6
```

There are two other optional arguments, `initial colour=[0 or 1]`, black or white obviously! And `reverse_panel=[bool]`a way to reflect the image, this is in case the panel has been put in the wrong way around. The panel object creates an image internally using PIL, in the case above a 56px width (2x28) by 21px high (3x7) image is created. Using the `__getattr__()` method, any PIL object applied to the fliPIL based object unknown will be applied to the internal image object, that way PIL objects like ImageDraw can be applied to it. Below I initiate `ImageDraw()` then I draw an ellipse.

```python
draw = ImageDraw.Draw(panel1)
draw.ellipse((0,0,10,10), outline=1, fill=0)
```

The image data bears no resemblance to the *Alfa-Zeta* protocol so this needs to be translated using the rows and columns layout into a command. Then there is a method to send the command over the serial connection. You can see I intended `_translate()` to be a private method that would run every time I made a change to the image display but then I realised it would be more efficient to run it only when needed. I need to remove the underscore but I am committed to it now!

```python
panel1._translate()
panel1.send()
```

Finally I also added a command to 'clear' the image, this is very useful if you are animating. The `0` is the colour it clears to, so in theory you can make it all white!

```python
panel1.clear(0)
```

That's it! you can see an example below of a "bouncing ball" animation on a 2x6 panel display. Notice that because it has an image representing the display in the wrapper program, I can get the width and height of the display, so those properties will automatically change if I change the size of the panel, this demonstrates the flexibility of the wrapper.

@[youtube](https://www.youtube.com/watch?v=ELED1-Cavog)

flipdot_bounce.py
```python

from PIL import ImageDraw
from flipil import flipil

  from time import sleep
  refresh = [0x80,0x82,0x8F]

  panel_adds =[[1,2],[3,4],[5,6],[7,8],[9,10],[11,12]]

  panel1 = flipil("alfa_zeta", [28, 7], panel_adds, init_color = 0, reverse_panel=False)
  panel1.set_port('/dev/ttyAMA0', 57600)

  draw = ImageDraw.Draw(panel1)

  size = 10
  dir_x = 1
  dir_y = 1
  x = 1
  y = 1

  while True:
      sleep(.01)

      if x+size+2 > panel1.width or x < 1:
                dir_x *= -1
      if y+size+2 > panel1.height or y < 1:
                dir_y *= -1

      x += dir_x
      y += dir_y

      panel1.clear(0)
      draw = ImageDraw.Draw(panel1)
      draw.ellipse((x,y,x+size,y+size), outline=1, fill=0)

      panel1._translate()
      panel1.send()
```

---

## Boldport Club

`02 January 2019` · [Open this post on its own](window:file/blog/2019-01-02-Boldport.md)

![Annanas](https://clacktronics.co.uk/assets/boldport.jpg)
In 2017 I started working for [Boldport](https://boldport.com) a PCB design company that specialises in attractive circuit boards and runs [boldport club](https://boldport.club) a monthly subscription where you receive a highly designed electronic kit every month. Above is the very first kit I designed called [Ananas](https://www.boldport.com/products/ananas/) it was a challenge to make my first design 3D but it turned out very well! Boldport decided to [Change the way it works](https://www.boldport.com/blog/2018/10/18/boldport-club-is-changing) so I decided to write up how the design process works for a project kit. [Please read this blog post](https://www.boldport.com/blog/2018/11/22/ben-making-a-project) to find out about how this unique design was made *image courtesy Boldport ltd*

---

## Paris Opera

`26 June 2017` · [Open this post on its own](window:file/blog/2017-06-26-Paris_Opera.md)

![paris opera ceiling -  chagall painting, illuminated by DMX lights](https://clacktronics.co.uk/assets/Palais_garnier_roof_haroon_mirza.gif)
I had the rare opportunity to be a part of a project at the Palais Garnier, that is one of the main Opera house’s in Paris. I was working with Haroon Mirza to produce a live light and projection installation that interacted with a composition by Pierre Boulez called “Anthèmes II” and was a collaboration with the choreographer Wayne McGregor.

“Anthèmes II” was a fairly early production created at IRCAM by Boulez, using the latest technological research at that time. In fact it actually used early versions of “Max” the visual programming software. I had the opportunity to look at the technical document for that work, it was fascinating to see how the work has been adapted for each new advance in technology. Originally using a number of NeXT machines serial linked and processed with FX processors to now simply running on a single Macbook Pro! There are a lot of technical details in the work that I will skim over, but its basically a program that follows a solo violinist reacting and performing with them according to a score. It does things like passing the violinist sound through various FX and panning the results around 6 speakers, also triggering various samplers. The technicians from IRCAM kindly let us receive data feeds from the MAX/MSP program via open sound control so the elements we control could respond to the live sound. Below is an example of the peice played at the BBC Proms.

@[youtube](https://www.youtube.com/watch?v=TMYDgwNALY8)

The Palais Garnier is a very lavish building, with a complicated baroque style gilt interior. Haroon wanted to work with the internal structure of the auditorium, highlighting parts with lights. We focused on the windows that go around the dome of the auditorium, there were 64 little windows on the edge of the Chagall painting, this is an idea number when working computers! Those were each fitted with PARLED’s. The other element of the work was a projected backdrop on the stage, the idea was to make it look a little bit like an oscilloscope. The data provided to move the beam was quite slow so the movement of the dot was simply a rotating dot. I have recently been learning more about using mathematics to produce graphics from the great youtube series called coding with math by Keith Peters. To produce a rotation all I needed to do was use sine and cosine! The software I used to produce the visualisation was Processing.

Haroon typically produces light / audio works by programming Arduino’s (well AVR’s) built in PWM peripheral. To keep the sound but control the DMX lights I simply established a simple serial link over USB to the control program.

![paris opera control box diagram](https://clacktronics.co.uk/assets/Paris_opera_control_box.png)

Overall this was a very good experience, I got to try out experimental technology in a fairly low tech live production environment. There is little public recordings of the performance but bellow is a small excerpt from the rehearsals showing the projection and the lights performing.

@[youtube](https://www.youtube.com/watch?v=QnbSaL5OvnU)

---

## Cryptocoin ticker

`20 June 2017` · [Open this post on its own](window:file/blog/2017-06-20-cryptocoin_ticker.md)

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

---

Page 1 of 9

[Blog list](window:file/blog-list.md)
[Older posts >](window:file/blog-page-2.md)
