---
title: Paris Opera
tagline: 26 June 2017
style: plain
---
# Paris Opera

![paris opera ceiling -  chagall painting, illuminated by DMX lights](https://clacktronics.co.uk/assets/Palais_garnier_roof_haroon_mirza.gif)
I had the rare opportunity to be a part of a project at the Palais Garnier, that is one of the main Opera house’s in Paris. I was working with Haroon Mirza to produce a live light and projection installation that interacted with a composition by Pierre Boulez called “Anthèmes II” and was a collaboration with the choreographer Wayne McGregor.

“Anthèmes II” was a fairly early production created at IRCAM by Boulez, using the latest technological research at that time. In fact it actually used early versions of “Max” the visual programming software. I had the opportunity to look at the technical document for that work, it was fascinating to see how the work has been adapted for each new advance in technology. Originally using a number of NeXT machines serial linked and processed with FX processors to now simply running on a single Macbook Pro! There are a lot of technical details in the work that I will skim over, but its basically a program that follows a solo violinist reacting and performing with them according to a score. It does things like passing the violinist sound through various FX and panning the results around 6 speakers, also triggering various samplers. The technicians from IRCAM kindly let us receive data feeds from the MAX/MSP program via open sound control so the elements we control could respond to the live sound. Below is an example of the peice played at the BBC Proms.

@[youtube](https://www.youtube.com/watch?v=TMYDgwNALY8)

The Palais Garnier is a very lavish building, with a complicated baroque style gilt interior. Haroon wanted to work with the internal structure of the auditorium, highlighting parts with lights. We focused on the windows that go around the dome of the auditorium, there were 64 little windows on the edge of the Chagall painting, this is an idea number when working computers! Those were each fitted with PARLED’s. The other element of the work was a projected backdrop on the stage, the idea was to make it look a little bit like an oscilloscope. The data provided to move the beam was quite slow so the movement of the dot was simply a rotating dot. I have recently been learning more about using mathematics to produce graphics from the great youtube series called coding with math by Keith Peters. To produce a rotation all I needed to do was use sine and cosine! The software I used to produce the visualisation was Processing.

Haroon typically produces light / audio works by programming Arduino’s (well AVR’s) built in PWM peripheral. To keep the sound but control the DMX lights I simply established a simple serial link over USB to the control program.

![paris opera control box diagram](https://clacktronics.co.uk/assets/Paris_opera_control_box.png)

Overall this was a very good experience, I got to try out experimental technology in a fairly low tech live production environment. There is little public recordings of the performance but bellow is a small excerpt from the rehearsals showing the projection and the lights performing.

@[youtube](https://www.youtube.com/watch?v=QnbSaL5OvnU)

