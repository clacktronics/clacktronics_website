---
title: Maplin ADA Delay
tagline: 4 January 2013
style: plain
---
# Maplin ADA Delay

[![Maplin ADA](https://clacktronics.co.uk/assets/643_maplin-ada.jpg)](../assets/Maplin-ADA.jpg)
I had this one sitting on my desk a while. Whilst at the [Music Hackspace](http://musichackspace.org/) in London another member ([Bioni Samp](https://bionisamp.wordpress.com/)) showed me this to look at. At first I thought it must just be another BBD or specialist IC delay but upon looking inside I realised it was a discrete 8 bit digital delay using an 8k x 8 sram IC as its memory. It was broken and I didnt really have enough time to fix it but because it was so interesting I took it.

[![Maplin ADA inside](https://clacktronics.co.uk/assets/643_maplin-ada-inside.jpg)](../assets/Maplin-ADA-inside.jpg)
It was a kit from Maplins called ADA Delay, I started to trace it but then discovered a member of [Sdiy mailing list](https://web.archive.org/web/20131014142208/http://dropmix.xs4all.nl/mailman/listinfo/synth-diy/) (wayback mirror) had a copy of the original article. It was written by Robert Penfold for Maplin Magazine (will attach soon). It has also been modified with a LFO that modulates the clock rate of the delay therefore changing its delay time. This is great and kind of turns the delay into a phaser. Issue was that the ADC had blown, pulling a lot of current from the -5v rail and in turn blown its regulator. Easy fix, just replaced the (now quite expensive) ZN448 ADC and the regulator. The bulb was a minature "grain of rice" type incandescent bulb so I replaced it with a white LED.

Needless to say, this has given me some ideas on how to make an Arduino like delay, possibly by just controlling the address of the digital signal to the RAM you could come up with some interesting delay effects.
