# What people can do with DriveGen and StudioGen: the task catalogue

A working list for the script library (draft for discussion, 23 Oct 2026). Each task is something a person asks for, by voice or typing, in the car (DriveGen) or at the desk (StudioGen), that the Mac carries out as an agent: with its apps, web pages, files, data and Apple's on-device model.

**How to read it.** Each line: the task · *parameters* (the words filled from what was said) · where it runs (**Mac**, **phone**, **mesh**) · what it needs (Outlook web, Mail, a database…). ⚠ = acts on your behalf (sends, pays, deletes, books): always confirmed first.

---

## 1. Mail (Outlook web, Mail, Gmail)
1. Summarise my unread mail · *mailbox, since* · Mac · Outlook web / Mail
2. Read the mail from Priya · *from, newest/all* · Mac
3. Anything urgent since this morning? (the model ranks by sender, words, deadlines) · *since*
4. Mails about the invoice / the Acme deal · *topic, from, date range*
5. What did Rahul ask me to do this week? (action items across mails) · *person, period*
6. Reply to the last mail from Priya saying I'll be 10 minutes late · *to, message* ⚠
7. Draft a reply to that mail, accepting the meeting · *intent, tone* (drafted, sent only on yes) ⚠
8. Forward the latest statement to my accountant · *what, to* ⚠
9. Flag / archive / move all newsletters from today · *rule* ⚠
10. Turn on my out-of-office until Monday · *until, message* ⚠
11. Has the client replied to my proposal yet? · *thread, from*
12. Count and list the mails waiting for my reply for more than 3 days · *days*
13. Unsubscribe from that newsletter · *sender* ⚠
14. Save the attachments from Priya's mail to the project folder · *from, folder*
15. Find the mail with the flight booking and tell me the PNR · *what to extract*

## 2. Calendar and meetings
16. What's my day? (agenda, gaps, first meeting, travel time) · *day*
17. When is my next meeting, and with whom?
18. Prepare me for my 10 am: attendees, last mails with them, shared documents, open items · *meeting/time*
19. I'm running late: tell the next meeting's attendees · *minutes* ⚠
20. Move my 3 pm to tomorrow, same time · *meeting, new time* ⚠
21. Find a free hour with Priya this week · *person, length, period*
22. Join my meeting (opens the Teams/Zoom link on the Mac, camera off) · *meeting*
23. Book the small room for the 4 pm call · *room, time* ⚠
24. Decline everything after 6 pm today · *time* ⚠
25. Summarise yesterday's meeting from its notes/transcript · *meeting*
26. Remind me to send the deck after this meeting · *what, when*
27. How much of my week is in meetings? (chart on screen) · *period*

## 3. Messages and calls (phone, Slack, Teams, WhatsApp)
28. Read my messages / the last message from Mom · *who*
29. Text Priya I'm on my way, with my ETA · *who* ⚠
30. Post in #sales that the numbers are out · *channel, message* ⚠ (Slack/Teams web on the Mac)
31. Any mentions of me on Slack today? · *since*
32. Call the next meeting's organiser · *meeting* ⚠
33. Who called while I was driving?
34. Send the meeting link to the person I'm calling · *who* ⚠

## 4. Documents and files (Mac)
35. Find the latest version of the pricing sheet · *name, type, modified*
36. Summarise this PDF / the contract I got from Legal · *file* (on-device model)
37. Read the executive summary aloud while I drive · *file, section*
38. What changed between v3 and v4 of the proposal? · *files*
39. Pull the action items out of the meeting notes into Reminders · *file* ⚠
40. Fill the travel-request template with this trip · *template, fields*
41. Convert the deck to PDF and send it to Priya · *file, to* ⚠
42. Rename / tidy the Downloads folder by type and date · *folder, rule* ⚠
43. Share a link to the Q3 report · *file, people* ⚠
44. Translate this document to Hindi · *file, language*
45. Back up the project folder to the drive · *folder, target*

## 5. Presenting (StudioGen's home ground)
46. Present the keynote with the assistant (slides, voice, gestures) · *deck/script*
47. Rehearse: run through the deck, time each slide, tell me where I rushed · *deck*
48. Answer questions from the audience using the deck and its notes · *deck*
49. Start the keynote on all screens / in tandem, next, cue, stop (from the car or the stage) · *script, screens*
50. Make a 5-slide outline from my notes / this document · *source, length*
51. Show the sales chart on the big screen · *data, chart, screen*
52. Switch the lobby screen to the welcome loop · *screen, script*
53. Read the speaker notes for slide 4 into my ear only (presenter view) · *slide*
54. Put the audience poll up and read the results · *question*
55. Translate the talk live into captions · *language*
56. Count down 5 minutes before the session starts, then begin · *minutes, script*

## 6. Data and reports (Mac: SQLite, CSV/Excel, web dashboards)
57. Sales summary for this month / vs last month · *period, region*
58. Top 5 customers by revenue this quarter · *metric, n, period*
59. Is anything unusual in today's orders? (the model explains the outliers) · *dataset, day*
60. Refresh the KPI dashboard and show it on the office screen · *dashboard, screen*
61. Make the weekly report: numbers, chart, three-line summary, ready to send · *period* ⚠ to send
62. How many tickets are open, and the oldest? · *queue*
63. Export last month's expenses to CSV and email finance · *period, to* ⚠
64. Chart revenue by month for the year · *metric, period*
65. Alert me when stock of item X falls below 50 · *item, threshold* (background job)

## 7. Web tasks (recorded web steps on the Mac, in its browser widgets)
66. Check the status of my Amazon order · *order*
67. Check-in for my flight and send me the boarding pass · *flight* ⚠
68. Flight status of AI 505 / when should I leave for the airport · *flight*
69. Fill my timesheet for this week with the usual split · *week, split* ⚠
70. Download this month's bank / card statement into Finance · *account, month*
71. Track the price of that laptop and tell me when it drops · *product, price*
72. Book a parking slot at the office for tomorrow · *date* ⚠
73. Renew the car insurance quote and compare two · *policy* (no payment typed by the agent)
74. Raise an IT ticket: laptop battery drains fast · *category, text* ⚠
75. Check my leave balance on the HR portal
76. Submit the expense with the receipt photo I just took · *amount, category, photo* ⚠
77. Log in-car mileage to the travel portal · *trip* ⚠

## 8. Work tools and the Mac itself
78. Run the test suite / build and tell me if it passed · *project*
79. Is CI green on main? Which job failed and why? · *repo*
80. Pull the latest code and restart the local server · *project* ⚠
81. Deploy status of the release · *service*
82. How is the Mac doing: battery, disk, memory, what's draining it?
83. Lock the Mac / put it to sleep / wake it before I arrive · ⚠
84. Turn on the VPN and open my work apps · *profile*
85. Update apps overnight and tell me in the morning
86. Clear the cache / restart the stuck app · *app* ⚠
87. Take a screenshot of the dashboard and send it to me · *window* ⚠
88. Start a long job (export, render, training) and tell me when done · *job* (background, await)

## 9. In the car (DriveGen)
89. Commute brief: traffic, first meeting, weather, one urgent mail
90. Navigate to my next meeting's address / the office / home · *destination*
91. Share my ETA with whoever I'm meeting · *who* ⚠
92. Remember where I parked (and photo of the pillar) · *spot*
93. Find fuel / a charger / coffee on my route · *what*
94. Read me the news headlines / my Pocket list / a podcast summary · *topic*
95. Voice note: take this down and put it in Notes on my Mac · *text*
96. Remind me when I get to the office to call the bank · *place, task*
97. What do you see? (the camera: signs, traffic, objects)
98. Play my driving playlist on the car speakers / the radio station · *playlist, station*
99. How long is the drive, and when should I leave for the 4 pm? · *meeting*
100. Tell my Mac to prepare the conference room screen before I arrive · *script, screen*
101. Log the trip for reimbursement · *trip*

## 10. Home and office (Shortcuts and HomeKit through the Mac)
102. I'm 10 minutes away: AC on, lights on · *scene* ⚠
103. Open the garage when I arrive · *door* ⚠ (confirmed)
104. Office arrival: wake the Mac, open today's apps, start focus music · *routine*
105. Leaving work: close apps, back up, lock, lights off · *routine* ⚠
106. Is the front door locked? · *device*

## 11. Personal productivity
107. Plan my day: meetings, three priorities from mail and tasks, a focus block
108. Add buy milk to my shopping list / a to-do for Friday · *item, list, due*
109. What's on my to-do list for today? · *list*
110. End-of-day summary: done, open, tomorrow's first thing
111. Start a 45-minute focus session: do-not-disturb, music, timer · *minutes*
112. Translate this phrase / what does this word mean · *text, language*
113. Journal: how was today? (written into a dated note)
114. What did I promise people this week? (mail + messages + notes) · *period*

## 12. Research and learning (the on-device model, the web on the Mac)
115. Research a topic and give me a one-page brief on screen · *topic, depth*
116. Summarise this article / YouTube video / web page · *link*
117. Compare these two products / vendors · *names*
118. Explain this error message / this clause in simple words · *text*
119. Stock / crypto watchlist update · *symbols*
120. Quiz me on the deck before the pitch · *deck*

## 13. Team, mesh and many screens
121. Who's around and what are they running? (mesh)
122. Run the sales summary on the office Mac / on whichever Mac has Excel · *script, device*
123. Push this script to all the Macs in the mesh · *script*
124. Put the announcement on every screen now · *message, screens*
125. Collect today's numbers from each office Mac into one report · *script, devices*
126. Lend my Mac's model to the phone (phones ask their Mac) · built in
127. Kiosk: the lobby screen loops the welcome tour, the assistant greets visitors · *screen, script*
128. Hand over: my colleague takes over the show from their Mac · *show, device*

## 14. Money and admin ⚠ (always confirmed, never types payment details)
129. How much did I spend on food this month? (statements) · *category, month*
130. Which bills are due this week? · *period*
131. Scan this receipt and add it to expenses · *photo*
132. Prepare the invoice for Acme from the template · *client, items* ⚠
133. Remind me before the card payment date · *card*

## 15. Accessibility and wellbeing
134. Read what's on the screen / this window aloud · *window*
135. Describe this photo / what the camera sees
136. Remind me to take a break every hour while I present / work · *interval*
137. Make the text bigger on the stage screen · *size*

## 16. Composite journeys (one ask, many steps)
138. "Get me ready for the client meeting": route there, brief on attendees and mails, open the deck on the Mac, tell the client I'm 5 minutes out ⚠
139. "Run my Monday": weekly report, KPI dashboard on the office screen, post the summary to the team ⚠
140. "Wrap up the trip": expenses from receipts, mileage logged, thank-you mails drafted ⚠
141. "Prepare the demo room": wake the room Mac, start the welcome loop, check the mic and camera, tell me when ready
142. "Catch me up after leave": mail summary by person and topic, meetings missed, decisions taken
143. "I'm stuck in traffic": ETA to the meeting, apology to attendees, move the meeting if over 20 minutes late ⚠

---

## Parameterised scripts: how the library would work
- **A script is a template** with named parameters, each with a type (person, date range, folder, mailbox, number…) and a default: `Summarise mail {from?} {since=today}`.
- **Triggers:** example sentences per script, not phrase permutations. The on-device model picks the script and fills its parameters from what was said, exactly as commands by meaning do now.
- **Steps** are the ones scripts already have (web steps, app steps, AppleScript/Shortcuts tasks, data queries, the Brain). Parameters are substituted into them, and the model handles the reading and summarising.
- **Results are typed** (summary, list, table, number with trend, chart, yes/no question), so every app can show them well, the car most of all.
- **Safety:** each script declares *reads* or *acts*. Acting needs a spoken or tapped "yes". No script ever types a password or payment detail (already a rule for web steps).
- **Needs:** each script declares what it requires (Outlook web signed in, Mail, a database file, Excel). The library shows what will work on this Mac and offers a setup step for the rest.
- **Shared:** the library lives in the mesh's shared things, so a script made on one Mac is runnable from every phone and Mac.

## DriveGen's home page: a results feed for the driver
- **The latest answer on top**, big and simple, and read aloud: "3 urgent mails: Priya (contract), IT (password), Rahul (Friday review)".
- **Card types matched to the result types:** one number with a trend; a short list (at most 3 lines while moving); a yes/no question with two big buttons; a map/ETA card; a "running on your Mac…" card with progress.
- **Rules while driving:** while the car moves, cards show at most a headline and three short lines, and anything longer is read aloud. Details open when parked. Tapping a card repeats it aloud.
- **Results from the Mac** (scripts run remotely) arrive in the same feed, as do background jobs when they finish ("Your export is done").
- **Below the feed:** a few suggested next asks based on the time and place (commute brief in the morning, "join your meeting" five minutes before).

## Questions to settle before building
1. **Which apps do you use?** Outlook web or the Outlook app, Teams or Slack, which calendar and drive (OneDrive, Box), which data sources. This decides the first 20 scripts.
2. **What should the first library cover?** I'd start with mail, calendar and meetings, presenting, data, and the car (sections 1, 2, 5, 6 and 9).
3. **Acting on your behalf:** a confirmation for everything that acts, or a per-script "trust" switch after the first few times?
4. **The DriveGen feed:** does it replace the car dashboard as the home, or sit beside it as its own screen?
