---
title: Blog (page 2)
tagline: Posts 6–10 of 44
style: plain
robots: noindex
---
# Blog

[Blog list](window:file/blog-list.md)
[< Newer posts](window:file/blog.md)
[Older posts >](window:file/blog-page-3.md)

Page 2 of 9

---

## Scanner Cloud

`18 May 2016` · [Open this post on its own](window:file/blog/2016-05-18-Scanner_Cloud.md)

![Foxall Studio Scanner - Image courtesy Foxall studio](https://clacktronics.co.uk/assets/Foxall_scanner.jpg)
Yes its true, I now do more than synths so my posts have diversified a bit although some new synth stuff coming soon, watch this space! This is a project I did a few months ago for [Foxall Studio](http://foxallstudio.com/project/publishing-rooms/) concept was to get around 50 flatbed scanners scattered around an exhibition space scanning in unison. Then creating clustered mosaics of images from the results that were displayed in the space using projections and printers. My task on the project became how to connect and power all of these scanners. We ended up using Raspberry Pis because it offered us the low cost and flexibility to position the scanners anywhere. I was sent this image below when the scanners arrived!

![Foxall Studio Scanner - Image courtesy Foxall studio](https://clacktronics.co.uk/assets/Foxall_scanner_pile.jpg)

That is a lot of testing to do! they were all second hand from a recycling center I believe.

On top of the function of scanning, the images from these scanners had to be shown in the space on a projector, be printed and hosted on a website.

So the challenge was

* How control configure all the scanners easily and at once
* How an application can pull these images from the scanners without having to try any special protocols or drivers.

If you had to iterate over 50 flatbed scanners every time a configuration needed changing that was a problem. There were many many different ways I explored how this could be set up, but the solution I ended up choosing was the one that was the quickest to prototype and made compatibility easy. In Linux compatibility was provided by the amazing [SANE](http://www.sane-project.org/) driver and [pyinsane](https://github.com/jflesch/pyinsane) bindings for it in python so I could control the scanner. Then I turned each scanner into a basic web server using Python's [BaseHttpServer](https://docs.python.org/2/library/basehttpserver.html) which I love because it is the most simple and easy to use module. On each GET request the server would scan and return an image. Parameters such as resolution or colour mode could be simply put in the URL such as "http://scannerurl/?mode=color&resolution=100". My program also pulled info from the scanner and presented in under the root URL port 80. Why did I not use a lower level protocol to send images? I figured that there is not one contemporary programming language that does not have a quick library for HTTP requests, plus you can test it in browser!

![Foxall Studio Scanner - Image courtesy boningtongallery](https://clacktronics.co.uk/assets/Foxall_scanner_prints.jpg)

Some of the cameras had lenses attached to them that is why the images look like photographs this idea by Foxall Studio was to bring back the age of having to sit and wait for the photo to take like the dawn of photography. Where if you did not sit still the image distorted!

I then worked with [Sebastien Dehesdin ](http://bleepsandblops.com/) who produced a node.js server that pulled all the images from the scanners and served them online. Both of us could not install the work due to other commitments but somehow it worked out thanks to Foxall studio and the Gallery manager who learned a lot of shell commands fast!

**Reflection**

I learned a great deal on this project about working with scale and allowing flexibility. I am still not sure if it was the best idea to use Raspberry Pis (the new "I can do that with a .." device) distributing 5v 50 ways was a challenge, but I think I am missing what I would have had to have done trailing USB hubs everywhere to single servers! The 0 configuration idea worked very well though, no scanner was assigned to any particular device, scanners could be swapped out if they broke or did not work with the drivers.

See links below for more detail and the actual exhibition website.

* [PublishingRooms.com](http://publishingrooms.com)
* [Scanner Server Code on Github](https://github.com/clacktronics/Foxall_Scanner)
* [Bonington Gallery](http://boningtongallery.co.uk)

All images courtesy Foxall Studio and Bonington Gallery

---

## Shapeoko 2 Wasteboard

`20 March 2016` · [Open this post on its own](window:file/blog/2016-03-20-Shapeoko-2-clamping-wasteboard.md)

![Shapeoko waste board installed](https://clacktronics.co.uk/assets/shapeoko_2_clamping_table.jpg)
I have been using my Shapeoko on an off over the past few months and the most frustrating thing is clamping. Nothing is more annoying when you have perfectly aligned it and your clamp or screw moves and it all goes off! Best option is a surface that can be clamped to. I have seen other people try solutions like putting in nail nuts to the surface or just buying a pre-made aluminium clamp bed (£££). But I wasn't to sure about it, especially if as I have found my mill losses grip on the bit and it plunges right down I didn't want to collide with steel. I found a special router bit that lets you cut undercut grooves into wood so you can put bolt heads into it. Pictured above is it fitted to the Shapeoko and was quite easy to make (lots of dust though!)

![Shapeoko clamping board bolt demonstrated](https://clacktronics.co.uk/assets/shapeoko_2_clamping_table_bolt.jpg)

This seemed good as all I need is a cheap bit of MDF cut to size and then I can just route a grid of clamp groves. If I accidentally over cut it also doesn't matter as I can just make up another table when it is trashed. So it is like a waste board clamp table!

![Shapeoko after routing](https://clacktronics.co.uk/assets/shapeoko_2_clamping_table_routed.jpg)

My router slipped a little when I was cutting it as the guide is awful, I had to switch to using a bar of wood as a rail. It doesn't matter though, just looks ugly! Then I just used the supplied waste board as a guide for the bolt holes to bolt it into the frames. Next I will be making some clamps with the Shapeoko!

---

## VGA cap

`16 January 2016` · [Open this post on its own](window:file/blog/2016-01-16-VGA_cap.md)

![Raspberry Pi VGA, audio and composite breakout](https://clacktronics.co.uk/assets/Raspberry_pi_VGA.jpg)
Here is a PCB I have designed, it was made in response to the release of the Raspberry Pi Zero. For a low cost it helps to break out the analogue outputs from the zero. The analogue ports it provides are stereo audio, composite and VGA. This is all on the same edge as the Zero's existing connectors. This board is ideal if you want to utilize a computer monitor, especially if it has built in speakers like many 'multimedia' TFT screens that now cost very little second hand. Apart from the composite output it will also work on any Raspberry Pi that has the 40 pin GPIO header (Raspberry Pi A/B+ and the Raspberry Pi 2) I am fund raising to make a bunch of them on Kickstarter [see here](http://kck.st/1SuGDvV)

**It is a kit**

To make it as cheap as possible and easy to adapt for different purposes it is a kit / bare PCB that uses only through-hole components. Due to a lack of space all components are folded this may make it a little fiddly to construct if you have less experience but it is not too hard.

What this means though is that you can choose which way up the cap is mounted, if you what the VGA or not and if you are building into an enclosure the pads can be directly soldered.

@[youtube](https://www.youtube.com/watch?v=iH7NiAvxM0Y)

**Enabling the outputs**

Full instructions can be found on [crab.design](http://crab.design)

Due to space and cost the cap does not have auto configuration EEPROM as defined by the HAT specification. It has to be set up by editing the config.txt and adding files to the /boot/ partition.

For VGA it uses Gert van loos VGA666 circuit which uses a passive resistor network to perform the Digital to Analogue conversion. The pins it uses are slightly different to allow for the audio to also be broken out of the GPIO header. To activate VGA an 'overlay' has to be added to the configuration files of the boot partition. These will be provided in the Github repository.

Analogue audio is the same as the circuit on the Raspberry Pi B+ schematic, but instead the output comes from the GPIO. To activate another 'overlay' is used that comes with the default Rasbian distribution (pwm-2chan-overlay) If this and the VGA is activated only 4 GPIO pins will remain.

The composite is simply an extension of the new breakout pins next to the the Zero's GPIO header, it is connected by its own socket when the cap is pushed on.

The parts activated are up to the user by simply disabling and enabling parts in the config.txt file. More information will be up soon at the crab github pages.

[Github files](https://github.com/crab-design/analogue_cap)

**What is crab?**

Crab is going to be a series of circuits that I think are useful repeatable modules for use in installations. That is not strict though, I am also designing circuits and boards that can inspire ideas and teach that may not be so practical.

---

## CAD with code (OpenSCAD)

`16 January 2016` · [Open this post on its own](window:file/blog/2016-01-16-Openscad.md)

![OpenSCAD design view](https://clacktronics.co.uk/assets/OpenScad.jpg)
If you like to think in code this CAD program is great, especially if the design can be broken down into primitives. This is an example of a very basic shelf I designed but I have been using it for everything from designing mounts to hold PIR sensors to a shed that will become the new Clacktronics workshop!

![The final shelf](https://clacktronics.co.uk/assets/openscad_shelves.jpg)

The interesting thing is that you end up with segments of code that can represent the real life segments you need to cut to construct your design. Even better if doing something more complicated you can make it parametric by using variables and even iteration.

I have done slightly more complicated tasks with it apart from shelving! Here is an example of a job I did where I used mini PIR sensors in 3d printed mounts so they could be used to detect human movement but on a narrow beam.

![PIR Sensors](https://clacktronics.co.uk/assets/3d_printed_pir_sensor_housing.jpg)

The PCB slotted perfectly into the mount and was held in with hot glue. Details for this project can be found on the [Clacktronics Github](https://github.com/clacktronics/pir_sensors) page.

![PIR Sensors in OpenSCAD](https://clacktronics.co.uk/assets/OpenScad_PIR_sensor.jpg)

---

## Colours, Speakers and Pulses

`13 January 2016` · [Open this post on its own](window:file/blog/2016-01-13-Colours-speakers-pw.md)

![Shapeoko2](https://clacktronics.co.uk/assets/Horowitz_chamber.jpg)
This is a story about what I currently do, I have moved a little bit away from synthesizers but still make audio electronics for artist Haroon Mirza and sometimes other artists. The approach to making artworks are different to designing audio devices, as usually components and circuits are one-off designs or modified items which are usually used against their original intention. The reason I decided to write about this was to document how the system works for this particular work as it is using new technologies that are getting easier to prototype with. I am really impressed with this new microcontroller implementation of Python programming language called Micro Python.

@[youtube](https://www.youtube.com/watch?v=frSLjx-Af7U)

Courtesy the Tinguely Museum, Switzerland

**Background**

[Channa Horowitz](https://en.wikipedia.org/wiki/Channa_Horwitz) . was an American artist who came up with a system called 'Sonakinatography' which is a compound word of sound, motion and notation. According to Wikipedia the system was part of a proposal for a sculpture that she sadly never got to produce, she did produce drawings for the works and although they are scores for works they actually became 'artworks'.

I am not sure if I am allowed to post a photo of an artwork but if you search Sonakinatography in your favourite search engine you will see the drawings. The way the work was interpreted is that each horizontal line of Channa Horowitz's work is treated as a step, like a step sequencer this is fed to 8 RGB LED strips that each sit on top of a 3 channel sound bar (the speakers for TVs). The PWM control of the Red, Green and Blue is also fed into the 3 internal speaker cones od the sound bar ; so left speaker is red, middle green and right is blue.

**Better Specs**

For ages we had been using Arduinos and burning PICs to playback sequences but they had hit memory limits. This was temporarily helped by storing sequences as byte arrays (smaller than integers) and using an Arduino Mega with larger flash memory but as longer and longer sequences were used the devices kept running out of space. Channa Horowitz's work is up to 4000 lines so this would definitely overflow the memory! The only solution for this was to use external memory, ideally I thought was to use a memory card to make it easier to change sequences.

There also was a new requirement, for this new work it needed to drive 8 x RGB leds this means we would need a device to output 24 independent channels this is beyond the Arduino Mega alone. At first I investigated using serial controlled PWM devices such as the SPI controlled TLC5947 but a requirement was that each channel could have its own pitch, something not typically a concern of a PWM controller. Then I remembered I had recently acquired a microcontroller device a bit like Arduino called a PyBoard which is designed to run MicroPython as I mentioned earlier. Sadly it only could handle 20 channels, but surely it could do more! so I asked on the forum (http://forum.micropython.org/viewtopic.php?t=497) and surely enough Damien (who created both the language and the board ) showed me how to kludge 4 extra channels out of it.

**The Program**

Because Micro Python is very close to Python 3 it was very easy to prototype the program, after initial difficulties of getting all the PWM channels to work and reporting some bugs to Micro Python repository ( which get fixed fantastically fast! ) it was a breeze to prototype the program. As it is Python I could use regular expressions to parse text files this means that the sequences could be human readable (and forgive human error in coding the files) with no need for brackets or other types of programming syntax. The program simply reads the text files line by line and outputs it straight to the LEDs with no noticeable delay! As it is not 8bit but a 32bit ARM another amazing feature was that I could set the pitch of the channels to almost any frequency.

@[youtube](https://www.youtube.com/watch?v=b5rM0UPVj80)

![Howowitz PCB design](https://clacktronics.co.uk/assets/speaker_resistor.jpg)

**The Circuit**

The circuit was a little bit different to what I used before, usually I use MOSFETs to drive LED strips, by connecting them to ground. But for this circuit as each LED was also driving a speaker I thought maybe I would try a little less conventional component. I used the L293 H-bridge driver which is typically used for driving stepper motors and relays but as a speaker is quite similar I thought it should be suitable! it also had the added bonus of being able to drive current bi-directionally so I could drive common cathode or common anode LEDs without changing the circuit much. (this is done very simply with a jumper on the PCB ).

Now directly driving speakers with DC PWM works fine but it uses a lot of power which is fairly wasteful and unnecessary so I created a circuit that reduces the power with a limiting resistor and also removes DC with a cap, it also has diodes to prevent inductive kickback from the speakers.

![Howowitz PCB design](https://clacktronics.co.uk/assets/pcb_design.jpg)

**Designing the board**

At first I designed the board to be as tight as possible, but this was a complete mess, routes became very long and I had gangs of tracks adding big borders around the board, I found it much better to lay it out a little more spaced. It made the board quite large, it is a bit bigger than a euro card but much cleaner. Using the Press n Peel method I created a double sided mockup of the board, this was actually used in media images of the show! For the connections to the speakers I went for 3.5mm pluggable terminal blocks, these are great.

The speaker circuits were directly attached to the back of the speaker, I designed a PCB that could be clamped on the terminals of the speaker, this made it very convenient and made it easy to split the signal to the LED and the speakers. It is very important to limit the amount of wiring in installations as the more wiring the more likely they can snag and break!
Enclosing

Only issue with using terminal blocks is that they need square holes, for speed I decided to get a box lazercut this also allowed me to put markings on it and cutout a fan for a hole.

![Howowitz Enclosure](https://clacktronics.co.uk/assets/the_enclosure.jpg)
The Enclosure

---

Page 2 of 9

[Blog list](window:file/blog-list.md)
[< Newer posts](window:file/blog.md)
[Older posts >](window:file/blog-page-3.md)
