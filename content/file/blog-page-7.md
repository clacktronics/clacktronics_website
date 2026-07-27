---
title: Blog (page 7)
tagline: Posts 31–35 of 47
style: plain
robots: noindex
---
# Blog

[Blog list](window:file/blog-list.md)
[< Newer posts](window:file/blog-page-6.md)
[Older posts >](window:file/blog-page-8.md)

Page 7 of 10

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

## Octave Kitten Repair

`22 June 2011` · [Open this post on its own](window:file/blog/2011-06-22-octave-kitten-repair.md)

[![](https://clacktronics.co.uk/assets/643_octave_kitten_main_634.jpg)](https://clacktronics.co.uk/assets/Octave_Kitten_main_634.jpg)
A cut down Cat, but no less brilliant sounding synthesizer built by the  NY company Octave in the late seventies. Features very nice sounding  feature rich VCO and the legendary SSM2044 filter. Very similar style of layout to the Arp Odyssey, so much that they were sued for it.

For Sale here [http://bit.ly/kmuTTU](http://bit.ly/kmuTTU)

This  particular unit has been fully serviced by my including cleaning the  keyboard and all switches and sliders so it gives a clear un-crackley  sound. Cosmetically in brilliant condition apart from the edging on the  left cheek which has split. All knobs and sliders in tact!

---

## EDP Wasp Deluxe Repair

`08 June 2011` · [Open this post on its own](window:file/blog/2011-06-08-edp-wasp-deluxe.md)

[![](https://clacktronics.co.uk/assets/643_edp_wasp_deluxe-643.jpg)](https://clacktronics.co.uk/assets/EDP_Wasp_deluxe-643.jpg)
The Wasp Deluxe was an enhancement on the original Wasp, they removed the touch keyboard, put it in a big wooden case with a real keyboard and added an oscillator mixer and an external audio input and that was about it. The component designators (IC1... IC2...C1...R100 etc) are all the same as the original wasp.

I purchased this synthesizer completely broken a few weeks ago in a very  bad state, the circuit was non functioning and there had been some heavy  modification to the panels. If you look at the photos you can see  the back panel has been removed and the connector section cut out and  attached to the front of the synth. Also holes were drilled around the wasp  logo ( I presume this must have been for some modification pots or input jacks?)

There was little I could do about this so the panel was left and  the holes in the case and panel remain, the upside is I managed to  completely overhaul the circuit repairing all its issues and cleaning  all the knobs and switches.

I will soon be setting up a Wasp technical page with my own schematics and details to support these synthesizers.

For Sale here [http://tinyurl.com/636xfks](http://tinyurl.com/636xfks)

[![](https://clacktronics.co.uk/assets/643_edp_wasp_deluxe_con643.jpg)](https://clacktronics.co.uk/assets/EDP_Wasp_deluxe_Con643.jpg)

From looking at the circuitry I assume somebody tried to add external CV control to the circuit as there was evidence that a wire had been soldered to the CV input of the filter. What I am guessing is that they put too much current into the VCF as the OTA's were completely busted and I had to replace them both.

@[youtube](https://www.youtube.com/watch?v=y0aqhcPC-44)

A problem I also found was that because the rotary switches hold the PCB to the panel after years of holding the weight of the PCB it caused them to split apart and fail. Thankfully Alpha Taiwan make rotary switches that are identical and readily available from most suppliers.

[![](https://clacktronics.co.uk/assets/643_edp_wasp_deluxe_main643.jpg)](https://clacktronics.co.uk/assets//EDP_Wasp_deluxe_Main643.jpg)

Surprisingly the keyboard is in excellent condition, it definitly makes it a far more playable synthesizer without the touch keyboard, but it does make it quite a standard synth, for its size I would much rather have a Pro-one or a Mini Moog!!!

[EDP Wasp Deluxe Demo after Repair](http://soundcloud.com/clacktronics/edp-wasp-deluxe) by [Clacktronics Repair](http://soundcloud.com/clacktronics)
[![](https://clacktronics.co.uk/assets/643_edp_wasp_deluxe_bsck643.jpg)](https://clacktronics.co.uk/assets/EDP_Wasp_deluxe_Bsck643.jpg)

---

Page 7 of 10

[Blog list](window:file/blog-list.md)
[< Newer posts](window:file/blog-page-6.md)
[Older posts >](window:file/blog-page-8.md)
