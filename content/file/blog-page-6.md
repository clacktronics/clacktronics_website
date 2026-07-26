---
title: Blog (page 6)
tagline: Posts 26–30 of 44
style: plain
robots: noindex
---
# Blog

[Blog list](window:file/blog-list.md)
[< Newer posts](window:file/blog-page-5.md)
[Older posts >](window:file/blog-page-7.md)

Page 6 of 9

---

## Another Day, Another Couple of Wasps

`30 August 2011` · [Open this post on its own](window:file/blog/2011-08-30-another-day-another-couple-of-wasps.md)

![](https://clacktronics.co.uk/assets/643_2_edp_wasps.jpg)
I must seem to be obsessed at them moment , but wasps just keep coming my way! .. I guess there are a lot of broken ones out their because most of them are getting on now! Well it turned out I had two at the same time so I decided to demonstrate them linked, below is the results. Both of them are generating sounds from their internal speakers, its really great hearing them make sounds through independent speakers.

Its particularly good putting on portamento because all the oscillators slide at different rates giving a THX style effect.

@[youtube](https://www.youtube.com/watch?v=jTzpOaEJ114)

@[youtube](https://www.youtube.com/watch?v=YyxOUj8sYoE)

@[youtube](https://www.youtube.com/watch?v=ErJVEbtLNhY)

@[youtube](https://www.youtube.com/watch?v=mbs0FJA8_cQ)

---

## Wasp Patch Pad by SYNFINITY

`28 July 2011` · [Open this post on its own](window:file/blog/2011-07-28-wasp-patch-pad.md)

[![](https://clacktronics.co.uk/assets/643_wasp_patch_pad.jpg)](https://clacktronics.co.uk/assets/Wasp_patch_pad.jpg) Just got these patch pads from Michael at Synfinity. It is a pad of pages printed with the Wasp decal so you can easily write down patches the old fashioned way! On the back (not pictured) there is a wipeable laminated page for temporary record. heres what he says about them

> the WASP Patch Pad [was] manufactured, with the approval of Adrian Wagner  in fact they sold some on their 1981EDP roadshow. I still have a few left which I put on ebay or the VEMIA auction from time to time. I did an original design which included a wipeable laminated back that you could perfect your settings on and then transfer them to the permanent patch on paper. The pages where punched so they could be put in a loose leaf folder. - Michael

See his website and details here [synfinity.biz](https://web.archive.org/web/20100502024209/http://www.synfinity.eu:80/) (wayback mirror)

---

## Wasp Drive - First batch complete!!

`04 July 2011` · [Open this post on its own](window:file/blog/2011-07-04-wasp-drive-first-batch-complete.md)

[![](https://clacktronics.co.uk/assets/643_wasp-batch.jpg)](https://clacktronics.co.uk/assets/wasp-batch.jpg)Here is the first batch of Clacktronics new products, it is a Wasp Filter with a driving input, see more info [here](http://clacktronics.co.uk/products/wasp-drive).

http://cgi.ebay.co.uk/ws/eBayISAPI.dll?ViewItem&item=120745511966&ssPageName=STRK%3AMESE%3AIT

---

## Yamaha CS-10 Sub Octave Mod

`22 June 2011` · [Open this post on its own](window:file/blog/2011-06-22-yamahacs10.md)

[![](https://clacktronics.co.uk/assets/643_yamaha_cs80_sub_octave_mod.jpg)](https://clacktronics.co.uk/assets/Yamaha_CS80_Sub_octave_mod.jpg)The Yamaha CS series has some unique features inside and out. Most of the circuitry uses quite unusual IC's (custom perhaps?) . The VCO for a start uses an interesting method of resetting the core, I can't really go into detail because I can't exactly understand what is going on but it creates a very stable oscillator that was used in the polyphonic part of the CS series. It has quite a pleasant band-pass filter and very fast attack settings, it can sound a bit sterile but its unique-ness pays off for that.

Here I added a sub-octave [taken from Yves Usson's schematics,](http://yusynth.net/index_en.php?&arg=3) except I added a couple more flip-flop's to create 2 more octaves below! I thought this would be interesting because the VCO has quite a range, so you can end up with 2 pitches 4 octaves apart!

Sound Samples soon!

---

## Video Synthesis Part 1 : Getting into Video Circuits

`22 June 2011` · [Open this post on its own](window:file/blog/2011-06-22-video-synthesis-part-1-getting-into-video-circuits.md)

![](https://clacktronics.co.uk/assets/643_gieskes.gif) Frame from video by [Gijs Gieskes](http://gieskes.nl) Just recently I have been researching how to work with analogue video, specifically Composite (the yellow phono connector you get on a lot of consumer video equipment.) Here is some information I have found out.

Firstly composite video is far more complex than audio, the reason being that to represent a sound electronically you only need 2 dimensions amplitude over time. It is easily represented by voltage, making it possible to create quite interesting effects and adjustments to the sound with very little and low cost circuitry. Where as composite video is a 2 dimensional image (X,Y) over time with Brightness (luminance) and Colour (chrominance) information is still represented by a voltage, but it has to hold all that information in a 2 dimensional signal. To do this it is constructed of a repeating (scanning) waveform that contains triggers, frequency bursts and a DC voltage that each represent a different component of the image.

There is a good app note here that explains it a lot better and in depth than me by Maxim Semiconductors - [www.maxim-ic.com/app-notes/index.mvp/id/734](http://www.maxim-ic.com/app-notes/index.mvp/id/734)

Now, all this makes it quite difficult to use a handful of components to do anything effective as with sound. Of course you can glitch and mess up the image but in the end it gets a bit boring and 'samey' and pretty much consists of making the image glitch a bit. Composite video is quite a sensitive high frequency signal and for example if you want to change one parameter like contrast (luminance) you have to do it without affecting the other parts of the signal.

Ideally what you need to do is separate the parts (usually sync from luminosity and chrominance.)

There is a lot out there on what can be achieved with circuitry, but not a lot on how. Then I found this excellent book by [Elektor ](http://Elektor.com)that describes to the modern user (released 2011) on how it all works including how to decode and encode composite video! Also touches on lost historical technologies such as mechanical TV and spiral scanning.

[![](https://clacktronics.co.uk/assets/643_analogue-video-300.jpg)](https://clacktronics.co.uk/assets/Analogue-Video-300.jpg)Copyright Elektor

Below is some of the best bits I could find that certainly seem to have legs for direct video manipulation with circuitry.

**gieskes.nl**
http://vimeo.com/20876345

Gijs Gieskes created this fantastic swiping circuit based around micro-controllers that seem to work by switching between 2 video sources very quickly to create interesting fade patterns. His website is [gieskes.nl](http://gieskes.nl/visual-equipment/?file=vm1).

**256byteram**
http://youtu.be/W5wv7RbJ3EQ

Taking the idea of switches this video demonstrates using a comparator to super-impose video. His youtube channel is [256byteram](http://www.youtube.com/user/256byteram)

---

Page 6 of 9

[Blog list](window:file/blog-list.md)
[< Newer posts](window:file/blog-page-5.md)
[Older posts >](window:file/blog-page-7.md)
