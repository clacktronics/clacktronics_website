---
title: Scanner Cloud
tagline: 18 May 2016
style: plain
---
# Scanner Cloud

![Foxall Studio Scanner - Image courtesy Foxall studio](assets/old_assets/Foxall_scanner.jpg)
Yes its true, I now do more than synths so my posts have diversified a bit although some new synth stuff coming soon, watch this space! This is a project I did a few months ago for [Foxall Studio](http://foxallstudio.com/project/publishing-rooms/) concept was to get around 50 flatbed scanners scattered around an exhibition space scanning in unison. Then creating clustered mosaics of images from the results that were displayed in the space using projections and printers. My task on the project became how to connect and power all of these scanners. We ended up using Raspberry Pis because it offered us the low cost and flexibility to position the scanners anywhere. I was sent this image below when the scanners arrived!

![Foxall Studio Scanner - Image courtesy Foxall studio](assets/old_assets/Foxall_scanner_pile.jpg)

That is a lot of testing to do! they were all second hand from a recycling center I believe.

On top of the function of scanning, the images from these scanners had to be shown in the space on a projector, be printed and hosted on a website.

So the challenge was

* How control configure all the scanners easily and at once
* How an application can pull these images from the scanners without having to try any special protocols or drivers.

If you had to iterate over 50 flatbed scanners every time a configuration needed changing that was a problem. There were many many different ways I explored how this could be set up, but the solution I ended up choosing was the one that was the quickest to prototype and made compatibility easy. In Linux compatibility was provided by the amazing [SANE](http://www.sane-project.org/) driver and [pyinsane](https://github.com/jflesch/pyinsane) bindings for it in python so I could control the scanner. Then I turned each scanner into a basic web server using Python's [BaseHttpServer](https://docs.python.org/2/library/basehttpserver.html) which I love because it is the most simple and easy to use module. On each GET request the server would scan and return an image. Parameters such as resolution or colour mode could be simply put in the URL such as "http://scannerurl/?mode=color&resolution=100". My program also pulled info from the scanner and presented in under the root URL port 80. Why did I not use a lower level protocol to send images? I figured that there is not one contemporary programming language that does not have a quick library for HTTP requests, plus you can test it in browser!

![Foxall Studio Scanner - Image courtesy boningtongallery](assets/old_assets/Foxall_scanner_prints.jpg)

Some of the cameras had lenses attached to them that is why the images look like photographs this idea by Foxall Studio was to bring back the age of having to sit and wait for the photo to take like the dawn of photography. Where if you did not sit still the image distorted!

I then worked with [Sebastien Dehesdin ](http://bleepsandblops.com/) who produced a node.js server that pulled all the images from the scanners and served them online. Both of us could not install the work due to other commitments but somehow it worked out thanks to Foxall studio and the Gallery manager who learned a lot of shell commands fast!

## Reflection

I learned a great deal on this project about working with scale and allowing flexibility. I am still not sure if it was the best idea to use Raspberry Pis (the new "I can do that with a .." device) distributing 5v 50 ways was a challenge, but I think I am missing what I would have had to have done trailing USB hubs everywhere to single servers! The 0 configuration idea worked very well though, no scanner was assigned to any particular device, scanners could be swapped out if they broke or did not work with the drivers.

See links below for more detail and the actual exhibition website.

* [PublishingRooms.com](https://web.archive.org/web/20170223073116/http://publishingrooms.com/) (wayback mirror)
* [Scanner Server Code on Github](https://github.com/clacktronics/Foxall_Scanner)
* [Bonington Gallery](http://boningtongallery.co.uk)

All images courtesy Foxall Studio and Bonington Gallery
