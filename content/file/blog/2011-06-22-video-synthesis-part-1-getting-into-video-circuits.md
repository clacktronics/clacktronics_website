---
title: Video Synthesis Part 1 : Getting into Video Circuits
tagline: 22 June 2011
style: plain
---
# Video Synthesis Part 1 : Getting into Video Circuits

![](assets/old_assets/643_gieskes.gif) Frame from video by [Gijs Gieskes](http://gieskes.nl) Just recently I have been researching how to work with analogue video, specifically Composite (the yellow phono connector you get on a lot of consumer video equipment.) Here is some information I have found out.

Firstly composite video is far more complex than audio, the reason being that to represent a sound electronically you only need 2 dimensions amplitude over time. It is easily represented by voltage, making it possible to create quite interesting effects and adjustments to the sound with very little and low cost circuitry. Where as composite video is a 2 dimensional image (X,Y) over time with Brightness (luminance) and Colour (chrominance) information is still represented by a voltage, but it has to hold all that information in a 2 dimensional signal. To do this it is constructed of a repeating (scanning) waveform that contains triggers, frequency bursts and a DC voltage that each represent a different component of the image.

There is a good app note here that explains it a lot better and in depth than me by Maxim Semiconductors - [www.maxim-ic.com/app-notes/index.mvp/id/734](http://www.maxim-ic.com/app-notes/index.mvp/id/734)

Now, all this makes it quite difficult to use a handful of components to do anything effective as with sound. Of course you can glitch and mess up the image but in the end it gets a bit boring and 'samey' and pretty much consists of making the image glitch a bit. Composite video is quite a sensitive high frequency signal and for example if you want to change one parameter like contrast (luminance) you have to do it without affecting the other parts of the signal.

Ideally what you need to do is separate the parts (usually sync from luminosity and chrominance.)

There is a lot out there on what can be achieved with circuitry, but not a lot on how. Then I found this excellent book by [Elektor ](http://Elektor.com)that describes to the modern user (released 2011) on how it all works including how to decode and encode composite video! Also touches on lost historical technologies such as mechanical TV and spiral scanning.

[![](assets/old_assets/643_analogue-video-300.jpg)](assets/old_assets/Analogue-Video-300.jpg)Copyright Elektor

Below is some of the best bits I could find that certainly seem to have legs for direct video manipulation with circuitry.

**gieskes.nl**
@[video](http://vimeo.com/20876345){noautoplay controls}

Gijs Gieskes created this fantastic swiping circuit based around micro-controllers that seem to work by switching between 2 video sources very quickly to create interesting fade patterns. His website is [gieskes.nl](http://gieskes.nl/visual-equipment/?file=vm1).

**256byteram**
@[video](http://youtu.be/W5wv7RbJ3EQ){noautoplay controls}

Taking the idea of switches this video demonstrates using a comparator to super-impose video. His youtube channel is [256byteram](http://www.youtube.com/user/256byteram)
