---
title: Blog (page 9)
tagline: Posts 41–45 of 47
style: plain
robots: noindex
---
# Blog

[Blog list](window:file/blog-list.md)
[< Newer posts](window:file/blog-page-8.md)
[Older posts >](window:file/blog-page-10.md)

Page 9 of 10

---

## Realistic Reverb Noismaking Mods

`07 April 2011` · [Open this post on its own](window:file/blog/2011-04-07-realistic-reverb-noismaking-mods.md)

[![](assets/old_assets/643_realistic-reverb.jpg)](assets/old_assets/Realistic-Reverb.jpg) I found this Realistic Reverb in quite a bad state without a case at a car boot sale, I was intrigued, this is one of those effects that are notorious for all the wrong reasons! Noisy and not really a reverb more of a short delay or flanger (with no modulation.) Once I fixed it up I proceeded to modify a few parts to make it more experimental and push it to its extremes.  The slide pots were completely busted so I had to replace them. I adjusted the controls so that at moderate levels it will operate like normal but also can be pushed to the extreme. In this post I will describe how they work and how you can implement these mods yourself.

[Modified Realistic Reverb - Microphone Input](http://soundcloud.com/clacktronics/modified-realistic-reverb-1) by [Clacktronics Repair](http://soundcloud.com/clacktronics)

[Modified Realistic Reverb - Tibetan Buddihist Rights](http://soundcloud.com/clacktronics/modified-realistic-reverb) by [Clacktronics Repair](http://soundcloud.com/clacktronics)

[![](assets/old_assets/643_realistic-reverb-knobs-643.jpg)](assets/old_assets/Realistic-Reverb-Knobs-643.jpg)

The face was made by laser printing on Lazertran then wetting , applying then baking in the oven, it creates a very durable graphic. THe DC jack was left in place and is stuck through the enclosure through a square hole.

**Schematic**[
![](assets/old_assets/643_realistic-reverb-schematic-with-mods.gif)](assets/old_assets/Realistic-Reverb-Schematic-With-Mods.gif)

It is quite simple, locate R21 (on the board it is simply labeled '21') and replace. then replace VR2 the slider with a IMLog one, you can also use 1m linear if you cannot get a Log one. The switches are optional, they are only really necessary if you need to re-house it or if you want to get rid of the phono input on 'Line.'

[![](assets/old_assets/643_realistic-reverb-in-out-643.jpg)](assets/old_assets/Realistic-Reverb-IN-OUT-643.jpg)
[![](assets/old_assets/643_realistic-reverb-dc-643.jpg)](assets/old_assets/Realistic-Reverb-DC-643.jpg)

It really come alive with no input and just feedback as demonstrated below

[Modified Realistic Reverb - No input noise generation](http://soundcloud.com/clacktronics/modified-realistic-reverb-no) by [Clacktronics Repair](http://soundcloud.com/clacktronics)

@[youtube](https://www.youtube.com/watch?v=Qkex7GeJat4)

---

## Juno 60 Memory Repair

`14 March 2011` · [Open this post on its own](window:file/blog/2011-03-14-juno-60-memory-repair.md)

![](assets/old_assets/643_juno60.jpg) This Juno 60 was brought to me because it had had its memory replaced but it was still loosing it memory after a while. Opening it up revealed a bath of battery acid had eaten away at the RAM chips power pins, but not so much that they were disconnected. Meaning that when on the RAM appeared to work as the voltage drop across the corroded power pins didn't get low enough to stop the memory from working when on but when in battery mode it would drop below the minimum threshold scrambling the memory.  I also did a few things like cleaning the chorus buttons and cleaning the volume pot.

The two Ram chips with acid.

![](assets/old_assets/643_juno60_ram.jpg)

---

## AKG BX-20 Repair

`07 February 2011` · [Open this post on its own](window:file/blog/2011-02-07-akg-bx-20-repair.md)

![Spring Reverb](assets/old_assets/643_akg-bx20.gif) Amazing spring reverb that was bought of ebay broken, because of its size I had to fix it on site. It was producing no sound at all (most equipment has a certain amount of hiss.)

Then after a bit of testing I discovered there was no power supply voltage at all. After a bit of dismantling I managed to get to the PSU PCB which is relatively a simple (to the rest of the unit) 2 diode full wave rectifier. Basically what had happened was the (west German!) electrolytic's had completely shorted burning out the resistor.

![Burnt out AKG PSU](assets/old_assets/643_akg-bx-20-psu.jpg) So then it was just the case of taking it back to the workshop and replacing all the burnt out parts .. then with a bit of re-fitting it was alive!!

Here is the sound clip made by the owner, its a very tasty reverb .... maybe not worth the space it takes up!!

Amazingly AKG Still provide a support service manual for the BX-20  [found here](http://www.akg.com/site/powerslave,id,7,nodeid,7,_language,EN,cat,11.html)

---

## Roland Space Echo RE-201 Repair

`31 January 2011` · [Open this post on its own](window:file/blog/2011-01-31-roland-re201-repair.md)

![](assets/old_assets/643_rolandre201.jpg)
This space echo didn't have anything major wrong with it, just there were a lot of small problems that made it a bit poor for performing. It is a really excellent tape delay .. partly because it has a nice muffley effect on your sound and partly because there is something quite special about the way the delay moves when you change the tape speed. It is one of those machines that feel nice to play with even though you could probably do the same with a much more compact plug-in or simulator ( [Boss RE-20](https://web.archive.org/web/20110104134841/http://www.bosscorp.co.jp/products/en/RE-20/) (wayback mirror) .) It is quite common for people to think that it doesn't work properly when they plug in a guitar, this is because the impedance of both the 'mic' and 'instrument' inputs are quite low so when you plug the relatively high output impedance of a guitar into it you loose a lot of the high end. To solve this you can use a guitar pedal before the input or get it modified.

![](assets/old_assets/643_rolandre201_under_lid.jpg)

Problems were just crackley pots, the spring reverb was not working and the VU back light was dead. Here is a sample of it with a Yamaha CS-10 playing through it.

A good way to repair a potentiometer especially if you do not have a suitable replacement is to open it up and clean the tracks. It really depends on the way the pot is made and whether the tracks are just dirty or are worn away. Usually ... especially in older equipment , these parts are made simply with crimped metal enclosures that are easily removed and replaced by just bending its tags. I opened up the instrument volume pot then cleaned and re-lubricated it. Opening it up is shown below.

![](assets/old_assets/643_cleaning_pot.jpg)

For the VU back-light I could have just found a small bulb and replaced it, but I wanted to find something a bit more long term .. an LED. Luckily the bulb has its own power supply so by using a resistor I could limit the current to get a decent glow. The main problem with using a LED instead of a bulb, is that the LED has a more focused beam instead of the bulbs diffused glow. This meant the LED had to be re-positioned underneath the PCB, rather than right next to the back of the screen of the VU.

![](assets/old_assets/643_rolandre201_blue_backlight.jpg)

The connections to the spring reverb were just loose and I replaced the tape and cleaned the heads. You cannot use ordinary 1/4" tape it is best to use a special paper backed tape as it is better for the heads and it lasts longer, it can be found quite easily on ebay.

**Further Pictures**

[![](assets/old_assets/thumb_RolandRE201_PCB.jpg)](assets/old_assets/RolandRE201_PCB.jpg)
[![](assets/old_assets/thumb_RolandRE201_inside_on_side.jpg)](assets/old_assets/RolandRE201_inside_on_side.jpg)
[![](assets/old_assets/thumb_RolandRE201_inside.jpg)](assets/old_assets/RolandRE201_inside.jpg)
[![](assets/old_assets/thumb_RolandRE201_tape.jpg)](assets/old_assets/RolandRE201_tape.jpg)

---

## Small Eddystone / Hammond Enclosures

`27 January 2011` · [Open this post on its own](window:file/blog/2011-01-27-enclosures.md)

![](assets/old_assets/643_eddystone_enclosures.jpg)
Just bought samples of Hammond Enclosures Eddystone 11451 and 27969 they would make excellent mini pedals for a boost or some kind of feedback loop pedal  

See here for some amazing uses of these boxes in the related 1590a Hammond box ( eddystone is the uk branch that was bought out by Hammond in the late ninties )

[DIY   Stompboxes 1590a thread ](http://www.diystompboxes.com/smfforum/index.php?topic=64752.0)

---

Page 9 of 10

[Blog list](window:file/blog-list.md)
[< Newer posts](window:file/blog-page-8.md)
[Older posts >](window:file/blog-page-10.md)
