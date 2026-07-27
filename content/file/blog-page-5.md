---
title: Blog (page 5)
tagline: Posts 21–25 of 47
style: plain
robots: noindex
---
# Blog

[Blog list](window:file/blog-list.md)
[< Newer posts](window:file/blog-page-4.md)
[Older posts >](window:file/blog-page-6.md)

Page 5 of 10

---

## Maplin ADA Delay

`04 January 2013` · [Open this post on its own](window:file/blog/2013-01-04-maplin-ada-delay.md)

[![Maplin ADA](https://clacktronics.co.uk/assets/643_maplin-ada.jpg)](../assets/Maplin-ADA.jpg)
I had this one sitting on my desk a while. Whilst at the [Music Hackspace](http://musichackspace.org/) in London another member ([Bioni Samp](https://bionisamp.wordpress.com/)) showed me this to look at. At first I thought it must just be another BBD or specialist IC delay but upon looking inside I realised it was a discrete 8 bit digital delay using an 8k x 8 sram IC as its memory. It was broken and I didnt really have enough time to fix it but because it was so interesting I took it.

[![Maplin ADA inside](https://clacktronics.co.uk/assets/643_maplin-ada-inside.jpg)](../assets/Maplin-ADA-inside.jpg)
It was a kit from Maplins called ADA Delay, I started to trace it but then discovered a member of [Sdiy mailing list](https://web.archive.org/web/20131014142208/http://dropmix.xs4all.nl/mailman/listinfo/synth-diy/) (wayback mirror) had a copy of the original article. It was written by Robert Penfold for Maplin Magazine (will attach soon). It has also been modified with a LFO that modulates the clock rate of the delay therefore changing its delay time. This is great and kind of turns the delay into a phaser. Issue was that the ADC had blown, pulling a lot of current from the -5v rail and in turn blown its regulator. Easy fix, just replaced the (now quite expensive) ZN448 ADC and the regulator. The bulb was a minature "grain of rice" type incandescent bulb so I replaced it with a white LED.

Needless to say, this has given me some ideas on how to make an Arduino like delay, possibly by just controlling the address of the digital signal to the RAM you could come up with some interesting delay effects.

---

## Clacktronics does LED Projects

`04 January 2013` · [Open this post on its own](window:file/blog/2013-01-04-clacktronics-does-led-projects.md)

[![LED hoop](../assets/643_led-hoop.jpg)](../assets/LED-hoop.jpg)
I quite often get approached by artists and designers to produce electronic parts for them. Recently I seem to have made a lot of LED projects! Above is part of a series of LED hoops that were commissioned for the band Django Django. This was by the artist [Kim Coleman](http://kimcolemanprojects.com/) who needed them as a part of her stage design for the band. 

![Photo credit : Django Django ](../assets/643_ddphoto.jpg) 

First a Series of 3 hoops were made (pictured above, middle frame) theese were very basic white LED chains made from discrete 5mm diffused white LED's. I know it is a bit crazy doing a point to point chain of LEDs but I needed them to be difused! Then for their large performance at Sheppards Bush Empire I made RGB hoops that had smiley faces, I learnt my lesson and theese are RGB tape with epoxy coating to help diffusion. Each segment ( the hoop and the 2 eyes and the mouth ) could be RGB DMX controlled by the lighting engineer.

@[youtube](https://www.youtube.com/watch?v=OaeqY0oh3iE)

Finally I also made an interesting piece of lighting for the artist Ryan Gander, he commissioned me to find a way to make a flickering light that lasts.  As shown below (apologies for the mess!) here is a program I wrote to simulate bulb flicker. My solution is LED so it is completely solid state, the electronics were designed to withstand sub-zero conditions as it had to be used outside during winter in Denmark!

@[youtube](https://www.youtube.com/watch?v=RRyg7e9cVxA)

The code is fairly simple and parametric so it can be modified to make all sorts of flickering. See github link below.

[GitHub - Flicker_box](https://github.com/clacktronics/Flicker_box)

---

## Rebel Tech - Stoichea

`01 July 2012` · [Open this post on its own](window:file/blog/2012-07-01-592.md)

[![Rebel Tech - Stoichea](../assets/643_dsc_81401.jpg)](../assets/DSC_81401.jpg)
Recently I have been working with [Rebel Tech](http://www.rebeltech.org/) to release a new Eurorack module range based in London. It has been really interesting and something I have long been interested in producing. The first module is a dual Euclidean Sequencer and more details can be found on the website here 

[rebeltech.org/modules/stoicheia/](http://www.rebeltech.org/modules/stoicheia/)

Look out for more modules in the future, some influenced by clacktronics!

---

## Clacktronics back in new year!

`25 January 2012` · [Open this post on its own](window:file/blog/2012-01-25-clacktronics-back-in-new-year.md)

![](https://clacktronics.co.uk/research/pressnpeel/643_press_n_peel_ferric_chloride_fade.jpg)
There has been a bit of silence recently, this is because I have a new job! assisting in the design and installation of electronic works for the artist [Haroon Mirza](http://www.clickfolio.com/haroon/). But Clacktronics is still going, soon there should be a new pedal release and I have been getting into [Arduino](http://www.arduino.cc/) so expect some exciting new things and posts soon, including updates to the Analogue Drum Lab.

As part of this post I have just published a new article on using press'n'peel to make PCB's at home. It is a far more effective method of PCB fabrication than toner transfer with photopaper and requires much less equipment than photoresist.

[Press n Peel Walkthrough](window:file/misc/pressnpeel.md)

---

## Star Synare 3 Page

`29 September 2011` · [Open this post on its own](window:file/blog/2011-09-29-star-synare-3-page.md)

[![](https://clacktronics.co.uk/assets/643_synare3large_147-e1317332821202.jpg)](https://clacktronics.co.uk/assets/synare3large_147-e1317332821202.jpg)
New Page on the [Star Synare 3](https://clacktronics.co.uk/research/drumlab/star-synare-3) in the Analog Drum Lab project - making a DIY PCB soon so watch out! If you have any information on this drum or you own it please get into contact.

---

Page 5 of 10

[Blog list](window:file/blog-list.md)
[< Newer posts](window:file/blog-page-4.md)
[Older posts >](window:file/blog-page-6.md)
