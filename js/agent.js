'use strict';
/* ============================================================
   The agent: a library of tasks people ask for in words (by voice or typing), each a script template with named
   inputs, and the Agent screen (Home in the car) where every result shows as a card. Design: docs/agent-tasks.md.
   - A task: { id, name, group, about, runs: 'mac' | 'here', acts, confirm, params: { name: { ask, type, default,
     optional } }, examples: ['read the mail from {person}', …], steps: [script steps], result: '{card}' }.
     Steps are script steps (js/script.js: {variables}, set/if/each, any action) run by a runner of their own, so a
     presentation keeps going. A composite is a task whose steps run other tasks (`agent.task`).
   - Choosing one: example sentences first (Agent.match, when no voice command matched exactly), then by meaning with
     the on-device model (Intent in js/brain.js lists tasks as `task:<id>` with their inputs as slots).
   - Acting for you (sending, booking…): asked every time; the question offers “always” for that task (Agent.trust),
     taken back in the library. Missing inputs are asked for one at a time.
   - Where: 'mac' tasks use the Mac's agent browser (a hidden <webview> in the 'persist:browse' session, so the
     user's sign-ins to Outlook, Teams, Slack and WhatsApp on the web are kept); a phone asks its paired Mac to run them
     (link request 'task', only tasks of the Mac's own library, confirmed on the phone first). 'here' tasks run on the
     device asked (the car's: parking, arrival time, navigation).
   - Results are cards { type: list | summary | number | question | status | place, headline, items: [{ title, detail,
     when, place, person }], value, unit } in the feed (dd.agentFeed, the last 40), read aloud; while the car moves a card
     shows at most three lines.
   Loaded after bundles.js.
   ============================================================ */
const MAIL_LIST = '[role="listbox"] [role="option"]||[aria-label*="Message list"] [role="option"]||[role="main"]';
const MAIL_BODY = '[aria-label="Message body"]||[role="document"]||#ReadingPaneContainerId||[aria-label="Reading Pane"]||[role="main"]';
const CAL_VIEW = '[role="main"]';
const SEND_BTN = 'button[aria-label="Send"]||button[title="Send"]||button[aria-label^="Send"]';
// Where things are on Slack, WhatsApp Web and Teams (the practice copies in labs/practice follow the same structure); choices
// with || are tried in order. Also listed for LLMs in docs/llm/build-prompt.md: keep the two in step.
const SLACK = { sidebar: '.p-channel_sidebar||nav[aria-label="Sidebar"]||[role="tree"]', item: '.p-channel_sidebar__channel||[role="treeitem"]',
  unread: '.p-channel_sidebar__channel--unread||[role="treeitem"][aria-label*="unread"]', activity: '[data-qa="tab_rail_activity_button"]||button[aria-label="Activity"]',
  activityList: '[data-qa="activity_list"]||[data-qa="activity-item"]', messages: '[data-qa="message_container"]||[data-qa="virtual-list-item"]||[role="list"]',
  input: '[data-qa="message_input"] [contenteditable="true"]||div[role="textbox"][contenteditable="true"]' };
const WA = { list: '#pane-side', rows: '#pane-side [role="listitem"]||#pane-side [role="row"]', search: '[aria-label="Search input textbox"]||div[contenteditable="true"][data-tab="3"]',
  msgs: '#main [data-pre-plain-text]||#main [role="row"]', input: 'footer [contenteditable="true"]||[aria-label="Type a message"]' };
const TEAMS = { list: '[data-tid="chat-list"]||[role="tree"]', rows: '[data-tid="chat-list-item"]||[role="treeitem"]', msgs: '[data-tid="chat-pane-message"]||[data-tid="message-pane-list-viewport"]',
  input: '[data-tid="ckeditor"]||div[role="textbox"][contenteditable="true"]', send: '[data-tid="newMessageCommands-send"]||button[name="send"]||button[aria-label^="Send"]' };
const outlookOpen = (path, wait = MAIL_LIST) => ({ do: 'agent.open', value: `{outlook}${path}`, args: ['site=Outlook', `wait=${wait.split('||')[0]}`] });
const card = (ask, from = '{read}') => ({ do: 'ai.card', value: ask, args: [from], as: 'card' });

const AGENT_TASKS = [
  /* ---------- Mail (Outlook on the web) ---------- */
  { id: 'mail.unread', group: 'Mail', name: 'Summarise unread mail', runs: 'mac', about: 'Reads your Outlook inbox and sums up what is unread',
    examples: ['summarise my unread mail', 'summarize my unread emails', 'any new mail', 'what is in my inbox', 'read my new emails'],
    steps: [outlookOpen('/mail/inbox'), { do: 'agent.read', value: MAIL_LIST, args: ['keep=Unread'], as: 'read' },
      card('Sum up the UNREAD emails (rows that say Unread). Headline: how many and from whom. One item per email: title = sender and the subject in a few words; detail = what they want, in one line.')] },
  { id: 'mail.urgent', group: 'Mail', name: 'Anything urgent in my mail?', runs: 'mac', about: 'Picks out mails that need you today',
    examples: ['anything urgent in my mail', 'any urgent emails', 'what needs my reply today', 'urgent mail'],
    steps: [outlookOpen('/mail/inbox'), { do: 'agent.read', value: MAIL_LIST, as: 'read' },
      card('Which of these emails look urgent or need a reply today (a deadline, a direct question, an important sender, flagged)? Headline: how many and the most urgent. Items: sender and subject; detail: why it is urgent. None urgent: say so in the headline, no items.')] },
  { id: 'mail.from', group: 'Mail', name: 'Read the latest mail from someone', runs: 'mac', about: 'Finds the newest mail from a person and summarises it',
    params: { person: { ask: 'From whom?', type: 'person' } },
    examples: ['read the mail from {person}', 'read the email from {person}', 'summarise the mail from {person}', 'what did {person} write', 'latest mail from {person}', 'any mail from {person}'],
    steps: [outlookOpen('/mail/inbox'), { do: 'agent.type', value: 'Search', args: ['{person}', 'enter'] }, { do: 'wait', value: '3' },
      { do: 'agent.click', value: '', args: ['sel=[role="listbox"] [role="option"]'] }, { do: 'agent.wait', value: MAIL_BODY.split('||')[0], args: ['ms=8000'] }, { do: 'agent.read', value: MAIL_BODY, as: 'read' },
      card('Summarise this email from {person}. Headline: who wrote and what it is about, in one sentence. Items: the key points and anything they ask for, with dates.')] },
  { id: 'mail.topic', group: 'Mail', name: 'Mails about a topic', runs: 'mac', about: 'Searches your mail for a topic and lists what it finds',
    params: { topic: { ask: 'About what?' } },
    examples: ['mails about {topic}', 'emails about {topic}', 'find mail about {topic}', 'search my mail for {topic}'],
    steps: [outlookOpen('/mail/inbox'), { do: 'agent.type', value: 'Search', args: ['{topic}', 'enter'] }, { do: 'wait', value: '3' }, { do: 'agent.read', value: MAIL_LIST, as: 'read' },
      card('These are search results for “{topic}”. Headline: how many and the newest. Items: sender and subject; detail: date and one line on what it says.')] },
  { id: 'mail.find', group: 'Mail', name: 'Find a detail in my mail', runs: 'mac', about: 'Searches, opens the best match and pulls out what you asked for (a booking reference, an address…)',
    params: { what: { ask: 'What should I look for?' } },
    examples: ['find {what} in my mail', 'find {what} in my email', 'look up {what} in my mail', 'what is my {what}'],
    steps: [outlookOpen('/mail/inbox'), { do: 'agent.type', value: 'Search', args: ['{what}', 'enter'] }, { do: 'wait', value: '3' },
      { do: 'agent.click', value: '', args: ['sel=[role="listbox"] [role="option"]'] }, { do: 'agent.wait', value: MAIL_BODY.split('||')[0], args: ['ms=8000'] }, { do: 'agent.read', value: MAIL_BODY, as: 'read' },
      card('Find {what} in this email. Headline: the answer itself (the number, code, date or place), or that it is not there. Items: other useful details next to it.')] },
  { id: 'mail.send', group: 'Mail', name: 'Send an email', runs: 'mac', acts: true, confirm: 'email {person}: “{message}”', about: 'Writes a new mail in Outlook and sends it',
    params: { person: { ask: 'Who to?', type: 'person' }, message: { ask: 'What should it say?' }, subject: { optional: true, default: '{message}' } },
    examples: ['email {person} saying {message}', 'send an email to {person} saying {message}', 'mail {person} that {message}', 'write to {person} that {message}'],
    steps: [{ if: '{person_email} is empty', then: [{ do: 'agent.fail', value: 'I don’t have an email address for {person}: add it in Agent › Library › People.' }] },
      { do: 'agent.open', value: '{outlook}/mail/deeplink/compose', args: ['site=Outlook', `wait=${SEND_BTN.split('||')[0]}`, '?to={person_email}', '?subject={subject}', '?body={message}'] },
      { do: 'wait', value: '1.5' }, { do: 'agent.click', value: 'Send', args: [`sel=${SEND_BTN}`] }, { do: 'wait', value: '2' },
      { set: 'card', value: '{"type":"status","headline":"Sent to {person}","items":[{"title":"{message}"}]}' }] },
  { id: 'mail.reply', group: 'Mail', name: 'Reply to the latest mail from someone', runs: 'mac', acts: true, confirm: 'reply to {person}’s last mail: “{message}”', about: 'Opens their newest mail, replies and sends',
    params: { person: { ask: 'Reply to whom?', type: 'person' }, message: { ask: 'What should the reply say?' } },
    examples: ['reply to {person} saying {message}', 'reply to {person} that {message}', 'answer {person} saying {message}'],
    steps: [outlookOpen('/mail/inbox'), { do: 'agent.type', value: 'Search', args: ['{person}', 'enter'] }, { do: 'wait', value: '3' },
      { do: 'agent.click', value: '', args: ['sel=[role="listbox"] [role="option"]'] }, { do: 'wait', value: '2' },
      { do: 'agent.click', value: 'Reply', args: ['sel=button[aria-label="Reply"]||button[title="Reply"]'] }, { do: 'wait', value: '2' },
      { do: 'agent.type', value: 'Message body', args: ['{message}', 'sel=div[contenteditable="true"][aria-label*="Message body"]||div[contenteditable="true"][role="textbox"]'] },
      { do: 'agent.click', value: 'Send', args: [`sel=${SEND_BTN}`] }, { do: 'wait', value: '2' },
      { set: 'card', value: '{"type":"status","headline":"Replied to {person}","items":[{"title":"{message}"}]}' }] },

  /* ---------- Calendar (Outlook on the web) ---------- */
  { id: 'cal.today', group: 'Calendar', name: 'What’s my day?', runs: 'mac', about: 'Today’s meetings from your Outlook calendar, in order, with the gaps',
    examples: ['whats my day', 'what is on my calendar today', 'my meetings today', 'todays meetings', 'what does my day look like', 'my agenda'],
    steps: [outlookOpen('/calendar/view/day', CAL_VIEW), { do: 'wait', value: '2' }, { do: 'agent.read', value: CAL_VIEW, as: 'read' },
      card('This is today’s calendar (it is {time} now). Headline: how many meetings and the next one with its time. Items in time order: title = meeting name; when = its time; place = room or address (or “online”); person = organiser; detail = a free gap after it if there is one.')] },
  { id: 'cal.next', group: 'Calendar', name: 'My next meeting', runs: 'mac', about: 'The next meeting: when, where and with whom',
    examples: ['when is my next meeting', 'whats my next meeting', 'next meeting', 'what is next on my calendar'],
    steps: [outlookOpen('/calendar/view/day', CAL_VIEW), { do: 'wait', value: '2' }, { do: 'agent.read', value: CAL_VIEW, as: 'read' },
      card('This is today’s calendar; it is {time} now. Give ONLY the next meeting that starts after now. Headline: its name and in how long it starts. One item: title = name; when = time; place = room, address or “online”; person = organiser; detail = attendees if shown. None left today: say so in the headline, no items.')] },
  { id: 'cal.brief', group: 'Calendar', name: 'Brief me for my next meeting', runs: 'here', about: 'The next meeting plus your latest mail with its organiser',
    examples: ['brief me for my next meeting', 'prepare me for my next meeting', 'get me ready for my meeting', 'meeting brief'],
    steps: [{ do: 'agent.task', value: 'cal.next', as: 'next' },
      { if: '{next.items.0.person} is empty', then: [{ set: 'card', value: '{next}' }],
        else: [{ do: 'agent.task', value: 'mail.from', args: ['person={next.items.0.person}'], as: 'mail' }, card('Brief me for this meeting in a few lines: what it is, who, where, and what the latest mail with the organiser says.', 'Meeting: {next} Latest mail: {mail}')] }] },
  { id: 'cal.add', group: 'Calendar', name: 'Add a meeting', runs: 'mac', acts: true, confirm: 'add “{title}” to your calendar {when}', about: 'Creates an event in your Outlook calendar',
    params: { title: { ask: 'What is it called?' }, when: { ask: 'When?' } },
    examples: ['add {title} to my calendar {when}', 'put {title} in my calendar {when}', 'schedule {title} {when}', 'book {title} {when}'],
    steps: [{ do: 'ai.when', value: '{when}', as: 'slot' },
      { do: 'agent.open', value: '{outlook}/calendar/deeplink/compose', args: ['site=Outlook', 'wait=button[aria-label="Save"]', '?subject={title}', '?startdt={slot.start}', '?enddt={slot.end}'] },
      { do: 'wait', value: '1.5' }, { do: 'agent.click', value: 'Save', args: ['sel=button[aria-label="Save"]||button[title="Save"]'] }, { do: 'wait', value: '2' },
      { set: 'card', value: '{"type":"status","headline":"Added {title}","items":[{"title":"{title}","when":"{slot.start}"}]}' }] },
  { id: 'cal.late', group: 'Calendar', name: 'Tell my next meeting I’m late', runs: 'here', acts: true, confirm: 'tell the organiser of your next meeting you’re {minutes} minutes late', about: 'Emails the next meeting’s organiser',
    params: { minutes: { ask: 'How many minutes late?', default: '10' } },
    examples: ['tell my next meeting i am running late', 'i am running {minutes} minutes late', 'im running late', 'tell them i will be {minutes} minutes late'],
    steps: [{ do: 'agent.task', value: 'cal.next', as: 'next' },
      { if: '{next.items.0.person} is empty', then: [{ do: 'agent.fail', value: 'I couldn’t find who organises your next meeting.' }] },
      { do: 'agent.task', value: 'mail.send', args: ['person={next.items.0.person}', 'message=Running about {minutes} minutes late for {next.items.0.title}, sorry. On my way.', 'subject=Running late: {next.items.0.title}'], as: 'sent' },
      { set: 'card', value: '{sent}' }] },

  /* ---------- Messaging (Teams, Slack, WhatsApp on the web) ---------- */
  { id: 'teams.read', group: 'Messaging', name: 'Unread Teams chats', runs: 'mac', about: 'Who wrote to you on Teams, and what',
    examples: ['any teams messages', 'read my teams chats', 'unread teams messages', 'whats new on teams', 'unread teams chats'],
    steps: [{ do: 'agent.open', value: '{teams}', args: ['site=Teams', `wait=${TEAMS.list}`, 'ms=30000'] }, { do: 'wait', value: '1.5' },
      { do: 'agent.read', value: TEAMS.rows, args: ['keep=Unread'], as: 'read' },
      card('Teams chats with unread messages, one per line: Unread chat, the name, the time, the last message, then (N unread messages). Headline: how many chats and from whom. Items: one per chat; title = person or group; detail = the last message in a few words; when = the number of unread messages.')] },
  { id: 'teams.from', group: 'Messaging', name: 'Read a Teams chat', runs: 'mac', about: 'The latest messages in a chat with a person or group',
    params: { person: { ask: 'Which chat?' } },
    examples: ['read my teams chat with {person}', 'what did {person} say on teams', 'read teams messages from {person}', 'teams messages from {person}'],
    steps: [{ do: 'agent.open', value: '{teams}', args: ['site=Teams', `wait=${TEAMS.list}`, 'ms=30000'] },
      { do: 'agent.click', value: '{person}', args: [`sel=${TEAMS.rows}`] }, { do: 'agent.wait', value: TEAMS.msgs, args: ['ms=8000'] }, { do: 'wait', value: '1' },
      { do: 'agent.read', value: `${TEAMS.msgs}||[role="main"]`, as: 'read' },
      card('The latest Teams messages with {person}, oldest first, one a line: the sender, the time, a colon, then the message. Headline: what the chat is about, in one line. Items: up to five recent messages; title = who; detail = what they said; when = the time.')] },
  { id: 'teams.send', group: 'Messaging', name: 'Send a Teams message', runs: 'mac', acts: true, confirm: 'send “{message}” to {person} on Teams', about: 'A chat message to one person (their work email in People)',
    params: { person: { ask: 'To whom?', type: 'person' }, message: { ask: 'What should it say?' } },
    examples: ['tell {person} on teams {message}', 'teams {person} saying {message}', 'send a teams message to {person} saying {message}', 'message {person} on teams {message}'],
    steps: [{ if: '{person_email} is empty', then: [{ do: 'agent.fail', value: 'Teams needs {person}’s work email: add it in Agent › Library › People.' }] },
      { do: 'agent.open', value: '{teamschat}', args: ['site=Teams', `wait=${TEAMS.send}`, 'ms=30000', '?users={person_email}', '?message={message}'] },
      { do: 'wait', value: '1.5' }, { do: 'agent.click', value: 'Send', args: [`sel=${TEAMS.send}`] }, { do: 'wait', value: '1.5' },
      { set: 'card', value: '{"type":"status","headline":"Sent to {person} on Teams","items":[{"title":"{message}"}]}' }] },
  { id: 'slack.mentions', group: 'Messaging', name: 'Slack mentions and unread', runs: 'mac', about: 'What needs you on Slack: mentions, and channels and messages with something unread',
    examples: ['any slack messages', 'whats new on slack', 'slack mentions', 'did anyone mention me on slack', 'unread slack messages'],
    steps: [{ do: 'agent.open', value: '{slack}', args: ['site=Slack', `wait=${SLACK.sidebar}`, 'ms=30000'] },
      { do: 'agent.read', value: SLACK.unread, as: 'unread' },
      { do: 'agent.click', args: [`sel=${SLACK.activity}`, 'optional'] }, { do: 'agent.wait', value: SLACK.activityList, args: ['ms=8000'] },
      { do: 'agent.read', value: `${SLACK.activityList}||[role="main"]`, as: 'read' },
      { ...card('Slack mentions of me, one per line: who, the channel, the time, the message. Headline: how many and from whom. Items: one per mention; title = who and the channel; detail = what they want, in a few words; when = the time.'), as: 'mention_card' },
      { ...card('Slack channels and people with unread messages, one per line, with the count. Headline: how many. Items: title = the channel or person; detail = the count.', '{unread}'), as: 'slack_card' },
      { do: 'card.join', value: '', args: ['Mentions=mention_card', 'Unread=slack_card'], as: 'card' }] },
  { id: 'slack.channel', group: 'Messaging', name: 'Read a Slack channel', runs: 'mac', about: 'The latest messages in a channel or from a person',
    params: { channel: { ask: 'Which channel or person?' } },
    examples: ['read the {channel} channel on slack', 'whats new in {channel} on slack', 'read slack {channel}', 'what did {channel} say on slack'],
    steps: [{ do: 'agent.open', value: '{slack}', args: ['site=Slack', `wait=${SLACK.sidebar}`, 'ms=30000'] },
      { do: 'agent.click', value: '{channel}', args: [`sel=${SLACK.item}`] }, { do: 'agent.wait', value: SLACK.messages, args: ['ms=8000'] }, { do: 'wait', value: '1' },
      { do: 'agent.read', value: `${SLACK.messages}||[role="main"]`, as: 'read' },
      card('The latest Slack messages in {channel}. Headline: the gist in one line. Items: up to five recent messages, title = who, detail = what they said.')] },
  { id: 'slack.post', group: 'Messaging', name: 'Post in a Slack channel', runs: 'mac', acts: true, confirm: 'post “{message}” in {channel} on Slack', about: 'A message in a channel or to a person',
    params: { channel: { ask: 'Which channel or person?' }, message: { ask: 'What should it say?' } },
    examples: ['post in {channel} on slack {message}', 'slack {channel} saying {message}', 'tell {channel} on slack {message}', 'post {message} in {channel}'],
    steps: [{ do: 'agent.open', value: '{slack}', args: ['site=Slack', `wait=${SLACK.sidebar}`, 'ms=30000'] },
      { do: 'agent.click', value: '{channel}', args: [`sel=${SLACK.item}`] }, { do: 'agent.wait', value: SLACK.input, args: ['ms=8000'] },
      { do: 'agent.type', value: 'Message', args: ['{message}', 'enter', `sel=${SLACK.input}`] }, { do: 'wait', value: '1.5' },
      { set: 'card', value: '{"type":"status","headline":"Posted in {channel}","items":[{"title":"{message}"}]}' }] },
  { id: 'whatsapp.read', group: 'Messaging', name: 'Unread WhatsApp chats', runs: 'mac', about: 'Chats with unread messages on WhatsApp Web',
    examples: ['any whatsapp messages', 'read my whatsapp', 'unread whatsapp', 'whats new on whatsapp', 'unread whatsapp messages'],
    steps: [{ do: 'agent.open', value: '{whatsapp}', args: ['site=WhatsApp', `wait=${WA.list}`, 'ms=40000'] }, { do: 'wait', value: '1.5' },
      { do: 'agent.read', value: WA.rows, args: ['keep=unread message'], as: 'read' },
      card('WhatsApp chats with unread messages, one per line: the name, the time, the last message, then (N unread messages). Headline: how many chats and from whom. Items: one per chat; title = person or group; detail = the last message in a few words; when = the number of unread messages.')] },
  { id: 'whatsapp.from', group: 'Messaging', name: 'Read WhatsApp messages from someone', runs: 'mac', about: 'The latest messages in a chat',
    params: { person: { ask: 'Whose chat?' } },
    examples: ['read my whatsapp from {person}', 'what did {person} say on whatsapp', 'read whatsapp messages from {person}', 'whatsapp messages from {person}'],
    steps: [{ do: 'agent.open', value: '{whatsapp}', args: ['site=WhatsApp', `wait=${WA.list}`, 'ms=40000'] },
      { do: 'agent.type', value: 'Search', args: ['{person}', `sel=${WA.search}`] }, { do: 'wait', value: '1.5' },
      { do: 'agent.click', args: [`sel=${WA.rows}`] }, { do: 'agent.wait', value: WA.msgs, args: ['ms=8000'] }, { do: 'wait', value: '1' },
      { do: 'agent.read', value: `${WA.msgs}||#main`, as: 'read' },
      card('The latest WhatsApp messages with {person}, oldest first, each starting with [time] sender. Headline: what {person} said most recently, in one line. Items: up to five recent messages; title = who; detail = what they said; when = the time.')] },
  { id: 'whatsapp.send', group: 'Messaging', name: 'Send a WhatsApp message', runs: 'mac', acts: true, confirm: 'send “{message}” to {person} on WhatsApp', about: 'Finds the chat by name, types and sends',
    params: { person: { ask: 'To whom?', type: 'person' }, message: { ask: 'What should it say?' } },
    examples: ['whatsapp {person} saying {message}', 'send a whatsapp to {person} saying {message}', 'tell {person} on whatsapp {message}', 'message {person} on whatsapp {message}'],
    steps: [{ do: 'agent.open', value: '{whatsapp}', args: ['site=WhatsApp', `wait=${WA.list}`, 'ms=40000'] },
      { do: 'agent.type', value: 'Search', args: ['{person}', `sel=${WA.search}`] }, { do: 'wait', value: '1.5' },
      { do: 'agent.click', args: [`sel=${WA.rows}`] }, { do: 'agent.wait', value: WA.input, args: ['ms=8000'] },
      { do: 'agent.type', value: 'Type a message', args: ['{message}', 'enter', `sel=${WA.input}`] }, { do: 'wait', value: '1.5' },
      { set: 'card', value: '{"type":"status","headline":"Sent to {person} on WhatsApp","items":[{"title":"{message}"}]}' }] },

  /* ---------- Presenting ---------- */
  { id: 'present.start', group: 'Presenting', name: 'Start a presentation', runs: 'mac', about: 'Runs one of your scripts on the Mac',
    params: { script: { ask: 'Which script?' } },
    examples: ['present {script}', 'start the presentation {script}', 'start presenting {script}', 'run the presentation {script}'],
    steps: [{ do: 'script.run', value: '{script}' }, { set: 'card', value: '{"type":"status","headline":"Presenting {script} on the Mac"}' }] },
  { id: 'present.outline', group: 'Presenting', name: 'Outline a talk', runs: 'here', about: 'Five slide titles with a line each, from a topic',
    params: { topic: { ask: 'About what?' } },
    examples: ['outline a talk about {topic}', 'make a presentation outline on {topic}', 'slides about {topic}', 'outline slides on {topic}'],
    steps: [card('Make a five-slide outline for a short talk about {topic}. Headline: a title for the talk. Items: one per slide, title = slide title, detail = its key point in one line.', 'Topic: {topic}')] },
  { id: 'present.scripts', group: 'Presenting', name: 'What can I present?', runs: 'mac', about: 'The scripts on the Mac',
    examples: ['what can i present', 'which presentations do i have', 'list my scripts'],
    steps: [{ do: 'agent.scripts', as: 'card' }] },

  /* ---------- Web ---------- */
  { id: 'web.flight', group: 'Web', name: 'Flight status', runs: 'mac', about: 'Looks the flight up on the web',
    params: { flight: { ask: 'Which flight?' } },
    examples: ['flight status of {flight}', 'status of flight {flight}', 'is {flight} on time', 'when does flight {flight} land'],
    steps: [{ do: 'agent.open', value: 'https://www.google.com/search', args: ['?q=flight status {flight}', 'wait=#search'] }, { do: 'agent.read', value: '#search||#rso||body', as: 'read' },
      card('Flight {flight}, today or the next one: headline = whether it is on time, delayed, departed or landed, with the time. Two items, the departure and the arrival: title = the city or airport; when = the time; detail = the terminal and gate if the text gives them.')] },
  { id: 'web.news', group: 'Web', name: 'News headlines', runs: 'mac', about: 'Top headlines, or on a topic',
    params: { topic: { optional: true, default: 'top stories' } },
    examples: ['news about {topic}', 'headlines on {topic}', 'read me the news', 'whats in the news', 'news headlines'],
    steps: [{ do: 'agent.open', value: 'https://www.bing.com/news/search', args: ['?q={topic}', 'wait=.news-card'] }, { do: 'agent.read', value: '.news-card||.newsitem||main', as: 'read' },
      card('The news stories in this text about {topic}. Headline: the biggest story in one line. Items: up to five stories, title = the story in under ten words, detail = the source and how long ago.')] },
  { id: 'web.answer', group: 'Web', name: 'Look something up', runs: 'mac', about: 'Searches the web and answers briefly',
    params: { question: { ask: 'What should I look up?' } },
    examples: ['look up {question}', 'search the web for {question}', 'google {question}'],
    steps: [{ do: 'agent.open', value: 'https://www.google.com/search', args: ['?q={question}', 'wait=#search'] }, { do: 'agent.read', value: '#search||#rso||body', as: 'read' },
      card('Answer “{question}” from these search results. Headline: the answer in one sentence. Items: up to three supporting facts with their source.')] },
  { id: 'web.price', group: 'Web', name: 'Price of something', runs: 'mac', about: 'Prices on the web for a product',
    params: { product: { ask: 'Which product?' } },
    examples: ['price of {product}', 'how much is {product}', 'how much does {product} cost'],
    steps: [{ do: 'agent.open', value: 'https://www.google.com/search', args: ['?q={product} price', 'wait=#search'] }, { do: 'agent.read', value: '#search||#rso||body', as: 'read' },
      card('Prices of {product}. Headline: the lowest price seen and where. Items: up to four offers, title = shop, detail = price.')] },

  /* ---------- The car ---------- */
  { id: 'car.commute', group: 'Car', name: 'Commute brief', runs: 'here', about: 'Your day, urgent mail and the weather, one card each',
    examples: ['commute brief', 'brief me', 'morning brief', 'catch me up', 'what do i need to know'],
    steps: [{ do: 'agent.task', value: 'cal.today', as: 'day' }, { do: 'agent.task', value: 'mail.urgent', as: 'mail' }, { do: 'cmd', value: 'weather' },
      { set: 'card', value: '{"type":"status","headline":"That’s your brief"}' }] },
  { id: 'car.park', group: 'Car', name: 'Remember where I parked', runs: 'here', about: 'Keeps this spot (and a note)',
    params: { note: { optional: true, default: '' } },
    examples: ['remember where i parked', 'i parked here', 'save my parking spot', 'remember my parking {note}'],
    steps: [{ do: 'car.park', value: '{note}', as: 'card' }] },
  { id: 'car.findcar', group: 'Car', name: 'Where did I park?', runs: 'here', about: 'The saved spot, how far, and a way back',
    examples: ['where did i park', 'where is my car', 'find my car', 'take me to my car'],
    steps: [{ do: 'car.findcar', as: 'card' }] },
  { id: 'car.navnext', group: 'Car', name: 'Navigate to my next meeting', runs: 'here', about: 'Takes the next meeting’s address from your calendar',
    examples: ['navigate to my next meeting', 'take me to my next meeting', 'directions to my next meeting', 'drive to my meeting'],
    steps: [{ do: 'agent.task', value: 'cal.next', as: 'next' },
      { if: '{next.items.0.place} is empty', then: [{ do: 'agent.fail', value: 'Your next meeting has no address.' }] },
      { if: '{next.items.0.place} contains online', then: [{ do: 'agent.fail', value: 'Your next meeting is online.' }] },
      { do: 'nav.go', value: '{next.items.0.place}' }, { set: 'card', value: '{"type":"place","headline":"To {next.items.0.title}","items":[{"title":"{next.items.0.place}","when":"{next.items.0.when}"}]}' }] },
  { id: 'car.eta', group: 'Car', name: 'When do I arrive?', runs: 'here', about: 'Arrival time and time left on the route',
    examples: ['when do i arrive', 'when will i get there', 'how long to go', 'whats my arrival time'],
    steps: [{ do: 'car.eta', as: 'card' }] },
  { id: 'car.shareeta', group: 'Car', name: 'Share my arrival time', runs: 'here', acts: true, confirm: 'send {person} your arrival time on WhatsApp', about: 'Tells someone when you’ll arrive (WhatsApp, from your Mac)',
    params: { person: { ask: 'Who should I tell?', type: 'person' } },
    examples: ['share my eta with {person} on whatsapp', 'whatsapp {person} my eta', 'whatsapp {person} my arrival time', 'tell {person} on whatsapp when i arrive'],
    steps: [{ do: 'car.eta', as: 'eta' }, { do: 'agent.task', value: 'whatsapp.send', args: ['person={person}', 'message=On my way: {eta.headline}'], as: 'sent' }, { set: 'card', value: '{sent}' }] },
  { id: 'car.note', group: 'Car', name: 'Note for my Mac', runs: 'mac', about: 'Puts what you say into Notes on the Mac (allow it once at the Mac)',
    params: { note: { ask: 'What should the note say?' } },
    examples: ['take a note {note}', 'note that {note}', 'remind me on my mac {note}', 'add a note {note}'],
    steps: [{ do: 'os.applescript', value: 'on run argv\n  tell application "Notes" to make new note with properties {name:"From the car", body:(item 1 of argv)}\n  return "ok"\nend run', args: ['{note}'], as: 'ok' },
      { set: 'card', value: '{"type":"status","headline":"Noted on your Mac","items":[{"title":"{note}"}]}' }] },
];

/* ---------- The Mac's agent browser: a hidden browser widget kept signed in ---------- */
const AgentWeb = {
  wv: null, seq: 0, waits: new Map(), up: null, views: new Map(), box: null, cur: 'browse', // one browser per container (Containers, js/media.js)
  can: () => !!window.DriveDeckDesktop?.browser,
  el() {
    if (!this.box) {
      const box = this.box = document.createElement('div'); box.id = 'agentWeb'; box.className = 'ag-web';
      box.innerHTML = `<div class="ag-web-bar"><b class="ag-web-title">Agent browser</b><span class="ag-web-box"></span><span class="ag-web-url"></span><button class="chip" data-agweb="hide">Done</button></div>
      <div class="ag-web-view"><i class="ag-ring" hidden></i></div>
      <div class="ag-watch-log" hidden><ol></ol><div class="ag-watch-ctl" hidden><button class="chip accent" data-agstep="next">Next step</button><button class="chip" data-agstep="run">Run the rest</button><button class="chip" data-agstep="stop">Stop the task</button></div></div>`;
      document.body.appendChild(box);
    }
    if (!this.wv) this.use(this.cur);
    return this.wv;
  },
  /** The browser of a container (made the first time), shown in the panel; the others wait hidden, still signed in. */
  use(id) {
    const c = Containers.get(id); let v = this.views.get(c.id);
    if (!v) {
      const wv = document.createElement('webview');
      Object.entries({ partition: Containers.part(c.id), useragent: BROWSER_UA, src: 'about:blank', allowpopups: '', webpreferences: 'backgroundThrottling=no' }).forEach(([k, x]) => wv.setAttribute(k, x));
      $('.ag-web-view', this.box).prepend(wv);
      v = { wv, up: new Promise(r => wv.addEventListener('dom-ready', r, { once: true })) };
      wv.addEventListener('ipc-message', e => { if (e.channel !== 'dd-bridge') return; const m = e.args[0] || {}, h = m.id && this.waits.get(m.id); if (h) { this.waits.delete(m.id); return h(m); }
        if (typeof TaskTeach !== 'undefined') { if (m.type === 'step') TaskTeach.step(m.step); else if (m.type === 'ready') TaskTeach.page(m.url); } }); // Teach me: what you do becomes steps
      wv.addEventListener('did-navigate', e => { if (this.wv === wv) { const u = $('.ag-web-url', this.box); if (u) u.textContent = e.url; } });
      this.views.set(c.id, v);
    }
    for (const [k, x] of this.views) x.wv.hidden = k !== c.id;
    this.cur = c.id; this.wv = v.wv; this.up = v.up;
    const tag = $('.ag-web-box', this.box); if (tag) { tag.textContent = c.id === 'browse' && Containers.all().length < 2 ? '' : c.name; tag.style.setProperty('--c', c.color); tag.hidden = !tag.textContent; }
    return v.wv;
  },
  /** Open a page in the container its site belongs to (or the one asked for). */
  async go(url, container) {
    this.el(); const c = Containers.for(url, container); if (c.id !== this.cur) this.use(c.id);
    const wv = this.wv; await this.up;
    Log.i('agent', `Agent browser: ${url.replace(/\?.*/, '')}`, { container: c.name });
    await new Promise(res => { let t; const done = () => { clearTimeout(t); wv.removeEventListener('did-stop-loading', done); res(); }; wv.addEventListener('did-stop-loading', done); t = setTimeout(done, 30000); wv.loadURL(url).catch(() => {}); });
  },
  url() { try { return this.wv?.getURL() || ''; } catch { return ''; } },
  async call(op, args = [], ms = 20000) {
    const wv = this.el(), id = `ag${++this.seq}`; await this.up; // the browser must be ready before it can be asked anything
    return new Promise(res => {
      const t = setTimeout(() => { this.waits.delete(id); res({ ok: false, error: 'The page didn’t answer' }); }, ms);
      this.waits.set(id, m => { clearTimeout(t); res(m); });
      try { wv.send('dd-drive', { id, op, args }).catch?.(e => { this.waits.delete(id); clearTimeout(t); res({ ok: false, error: e.message }); }); } catch (e) { this.waits.delete(id); clearTimeout(t); res({ ok: false, error: e.message }); }
    });
  },
  async insert(text) { await this.wv.insertText(text); },
  key(k = 'Enter') { const wv = this.wv; wv.sendInputEvent({ type: 'keyDown', keyCode: k }); if (k === 'Enter') wv.sendInputEvent({ type: 'char', keyCode: '\r' }); wv.sendInputEvent({ type: 'keyUp', keyCode: k }); },
  /** Shown to sign in (full size, interactive). */
  show(on = true) { this.el(); const b = $('#agentWeb'); b.classList.remove('watch'); b.style.removeProperty('--s'); b.classList.toggle('show', on); document.documentElement.classList.remove('ag-watching'); },
  /** Shown to watch a task: a side panel, the page at its usual size (1280×860) drawn smaller, with the steps below. */
  watch(on = true) { this.el(); const b = $('#agentWeb'); b.classList.remove('show'); b.classList.toggle('watch', on); $('.ag-watch-log', b).hidden = !on;
    // on the Agent screen with the assistant beside the cards, the panel takes 40% so the cards stay in view between them
    const s = Math.min(0.62, Math.min(innerWidth * (current === 'agent' && $('#agentRoot.ag-has-av') ? 0.4 : 0.5), 820) / 1280);
    if (on) { b.style.setProperty('--s', s.toFixed(3)); document.documentElement.style.setProperty('--ag-ws', `${Math.round(1280 * s) + 24}px`); }
    document.documentElement.classList.toggle('ag-watching', on); },
};
document.addEventListener('click', e => { if (e.target.closest('[data-agweb]')) { AgentWeb.show(false); AgentWeb.watch(false); } });

/* ---------- Watching a task: each step listed as it runs (✓ or ✗ with why), the element it acts on ringed; optionally one
   step at a time (Next step / Run the rest / Stop), for finding out why a task doesn't work and fixing it. ---------- */
const AgentWatch = {
  force: false, // the editor's Test (watch) and Run
  on() { return AgentWeb.can() && (this.force || this.next || !!Agent.cfg().watch); },
  stepMode: false, gate: null, next: false, // next: watch the next task that runs (the builder's Run it, which may ask first)
  begin(t) {
    if (!this.on()) return; this.next = false; this.stepMode = !!Agent.cfg().stepMode; AgentWeb.watch(true);
    $('#agentWeb .ag-web-title').textContent = `Watching: ${t.name}`; $('#agentWeb .ag-watch-log ol').innerHTML = '';
  },
  label(id, v, a = {}) {
    const short = s => String(s || '').replace(/^https?:\/\//, '').slice(0, 70);
    return ({ 'agent.open': () => `Open ${short(v)}`, 'agent.read': () => `Read the page (${short(String(v).split('||')[0])})`, 'agent.wait': () => `Wait for ${short(v)}`,
      'agent.click': () => `Click ${v ? `“${short(v)}”` : short(agentArgs(a.args).sel?.split('||')[0])}`, 'agent.type': () => `Type into “${short(v)}”`, 'agent.key': () => `Press ${v || 'Enter'}`,
      'agent.confirm': () => `Ask “${short(v)}”`, 'ai.card': () => 'Ask the model for the card', 'card.join': () => 'Put the cards together', 'ai.when': () => `Work out the time “${short(v)}”` })[id]?.() || id;
  },
  async step(id, v, ev) {
    if (!this.on() || !$('#agentWeb')?.classList.contains('watch')) return null;
    const li = document.createElement('li'); li.className = 'work'; li.textContent = this.label(id, v, ev); $('#agentWeb .ag-watch-log ol').appendChild(li); li.scrollIntoView({ block: 'nearest' });
    if (this.stepMode) { li.classList.add('paused'); const ctl = $('#agentWeb .ag-watch-ctl'); ctl.hidden = false;
      const what = await new Promise(r => { this.gate = r; }); ctl.hidden = true; li.classList.remove('paused');
      if (what === 'run') this.stepMode = false; if (what === 'stop') { li.className = 'bad'; throw new Error('Stopped while watching'); } }
    return li;
  },
  done(li, ok, note) { if (!li) return; li.className = ok ? 'ok' : 'bad'; if (note) { const s = document.createElement('small'); s.textContent = note; li.appendChild(s); } },
  ring(rect) {
    const r = $('#agentWeb .ag-ring'); if (!r || !rect || !$('#agentWeb')?.classList.contains('watch')) return;
    const k = parseFloat(getComputedStyle($('#agentWeb')).getPropertyValue('--s')) || 1; // the page is drawn smaller in the panel
    Object.assign(r.style, { left: `${rect.x * k - 4}px`, top: `${rect.y * k - 4}px`, width: `${rect.w * k + 8}px`, height: `${rect.h * k + 8}px` }); r.hidden = false; clearTimeout(this.rt); this.rt = setTimeout(() => { r.hidden = true; }, 1600);
  },
  end(ok, why) {
    if (!$('#agentWeb')?.classList.contains('watch')) return;
    const li = document.createElement('li'); li.className = ok ? 'ok end' : 'bad end'; li.textContent = ok ? 'Done' : `Stopped: ${why}`; $('#agentWeb .ag-watch-log ol').appendChild(li); li.scrollIntoView({ block: 'nearest' });
    $('#agentWeb .ag-web-title').textContent = ok ? 'Task done' : 'Task didn’t work: see the steps';
  },
};
document.addEventListener('click', e => { const b = e.target.closest('[data-agstep]'); if (b && AgentWatch.gate) { const g = AgentWatch.gate; AgentWatch.gate = null; g(b.dataset.agstep); } });

/* ---------- Working on it: a short line at once, the assistant types and then thinks, and answers with a gesture ----------
   For anything that takes more than a moment (a task, a script on the Mac). The line is in the voice that starts at once
   here (the natural voice where it's fast, as on a Mac; the device's voice on a phone), so nobody waits in silence while the
   work and the reply's voice are being made. Nothing is said when the answer comes within half a second. In Drive mode the
   assistant only changes its face (Avatar.gesture). */
const FILLERS = ['On it. Give me a second.', 'Let me check.', 'Working on it.', 'One moment.', 'Sure, looking now.'];
const Working = {
  on: false, n: 0, t: 0, t2: 0, said: null,
  begin(o = {}) {
    this.stop(); this.on = true; const tok = ++this.n;
    this.t = setTimeout(() => {
      if (tok !== this.n) return;
      if (!o.silent) {
        const line = o.line || FILLERS[Math.floor(Math.random() * FILLERS.length)];
        Voice.reply?.(line); Log.i('tts', `Working: “${line}”`);
        this.said = Promise.resolve(/^(neural|phonon)$/.test(Voice.ttsMode()) ? Voice.speak(line) : (Voice.hush?.(), Voice.speakPhone(line, ++Voice.sayId))).catch(() => {});
      }
      if (typeof Avatar !== 'undefined') { Avatar.gesture('Typing'); this.t2 = setTimeout(() => tok === this.n && Avatar.gesture('Think', 20), 3000); }
    }, o.after ?? 500);
  },
  stop() { clearTimeout(this.t); clearTimeout(this.t2); },
  /** Done: let the line finish (at most 2.5 s), then the answer's gesture (a shrug when it didn't work). */
  async end(ok = true) {
    this.stop(); if (!this.on) return; this.on = false; this.n++;
    if (this.said) await Promise.race([this.said, new Promise(r => setTimeout(r, 2500))]);
    this.said = null;
    if (typeof Avatar !== 'undefined') Avatar.gesture(ok ? 'Explain' : 'Shrug');
  },
};

/* ---------- The library, matching, asking, running ---------- */
/** Words of a sign-in page, for sites whose address doesn't change while you sign in (WhatsApp, single-page apps). */
const SIGNIN_WORDS = /\b(scan the qr( code)?|use whatsapp on your computer|link with phone|log into whatsapp|sign in to (continue|your account)|sign in with|log in to (continue|your account)|enter your (email|password)|continue with (google|email|microsoft|apple)|forgot (your )?password)\b/i;
const SIGNIN = /login\.(microsoftonline|live|microsoft)\.com|accounts\.google\.com|signin|\/login|slack\.com\/(signin|get-started)/i;
const Agent = {
  ctx: null, queue: Promise.resolve(), pend: null,
  cfg: () => ({ outlook: 'https://outlook.office.com', remote: true, ...store.get('agentCfg', {}) }),
  /** The sites tasks use, as {outlook} {slack} {whatsapp} {teams} ({teamschat}: a new chat, with ?users=email&message=text): the real ones, or the practice copies (labs/practice). */
  sites() {
    const c = this.cfg(), here = f => new URL(`labs/practice/${f}`, location.href).href;
    return c.practice ? { outlook: here('inbox.html').replace(/\/inbox\.html$/, '/inbox.html#'), slack: here('slack.html'), whatsapp: here('whatsapp.html'), teams: here('teams.html'), teamschat: here('teams.html') }
      : { outlook: c.outlook.replace(/\/$/, ''), slack: 'https://app.slack.com/client', whatsapp: 'https://web.whatsapp.com/', teams: 'https://teams.microsoft.com/v2/', teamschat: 'https://teams.microsoft.com/l/chat/0/0' };
  },
  mine: () => store.get('agentTasks', []),
  /** Tasks the paired Mac has made itself (fetched from it; run there by id). */
  macMine: () => store.get('macTasks', []),
  /** Tasks other StudioGens in the mesh let this device run (fetched from them; run there): their shared ones without
      sign-ins, or all of them when this is one of their owner's own devices. */
  meshMine: () => store.get('meshTasks', []),
  all() {
    const own = this.mine(), ids = new Set(own.map(t => t.id)), mesh = this.meshMine();
    // no Mac of its own: a built-in another StudioGen shares runs there instead
    const noMac = !LINK_HOST && !(typeof Relay !== 'undefined' && Relay.mac()) && !Link.mac()?.token, viaMesh = new Set(noMac ? mesh.map(t => t.origId) : []);
    return [...own, ...this.macMine().filter(t => !ids.has(t.id)).map(t => ({ ...t, runs: 'mac', remoteOnly: true })), ...AGENT_TASKS.filter(t => !ids.has(t.id) && !viaMesh.has(t.id)), ...mesh];
  },
  get(id) { return this.all().find(t => t.id === id); },
  put(t) { const l = this.mine(), i = l.findIndex(x => x.id === t.id); if (i >= 0) l[i] = t; else l.push(t); store.set('agentTasks', l); },
  del(id) { store.set('agentTasks', this.mine().filter(t => t.id !== id)); },
  /** Phone hand-offs a task does better (sent from the Mac, no tap needed), when there's a Mac to do it. */
  overrides: id => /^phone\.whatsapp$/.test(id) && (AgentWeb.can() || Link.ready()),
  trusted: id => store.get('taskTrust', []).includes(id),
  trust(id, on) { const s = new Set(store.get('taskTrust', [])); on ? s.add(id) : s.delete(id); store.set('taskTrust', [...s]); },
  people: () => store.get('agentPeople', []),
  /** Whether a task (or a task it runs) acts for you. */
  acts(t, depth = 0) { if (!t || depth > 4) return false; if (t.acts) return true; return JSON.stringify(t.steps || []).match(/"agent\.task","value":"([\w.-]+)"/g)?.some(m => this.acts(this.get(m.match(/"value":"([\w.-]+)"/)[1]), depth + 1)) || false; },
  /** Here or on the Mac: 'mac' tasks need the agent browser (StudioGen) or a paired Mac; a mesh task runs on its StudioGen. */
  where(t) { return t.on ? 'mac' : t.runs !== 'mac' || (AgentWeb.can() && !t.remoteOnly) ? 'here' : 'mac'; },
  /** Where a 'mac' task goes: the paired Mac, or the StudioGen in the mesh that offers it. */
  target(t) {
    if (t?.on) return { meshId: t.on, name: t.onName || 'that StudioGen', ready: () => typeof Mesh !== 'undefined' && Date.now() - (Mesh.presence[t.on]?.at || 0) < 60000, call: o => Mesh.call(t.on, 'task', o, 300000), paired: true };
    const mid = typeof Relay !== 'undefined' ? Relay.mac()?.meshId : null;
    return { meshId: typeof Mesh !== 'undefined' && Mesh.member(mid) ? mid : null, name: Link.macName(), ready: () => Link.ready(), call: o => Link.task(o), paired: !!(typeof Relay !== 'undefined' && Relay.mac()) || !!Link.mac()?.token };
  },
  asking(t) { return this.where(t) === 'mac' ? `Asking ${this.target(t).name}…` : 'Working on it…'; },

  /* ---------- Only my devices: what needs this Mac's sign-ins (docs/studiogbee.html) ---------- */
  /** Whether a task needs its owner's sign-ins or personal data, so only their own devices may run it: it opens a sign-in
      site, runs in a container of its own, runs os.* / data.sql / phone steps, or runs a task that does; or it's ticked. */
  private(t, depth = 0) { if (!t || depth > 4) return false; if (t.private || (t.container && plain(t.container) !== 'default')) return true; return this.privateSteps(t.steps || [], depth); },
  /** The same for any steps (a script's too). */
  privateSteps(x, depth = 0) {
    const j = JSON.stringify(x || '');
    if (/\{(outlook|teams|teamschat|slack|whatsapp)\}|outlook\.(office|live)\.com|teams\.microsoft\.com|slack\.com|web\.whatsapp\.com/i.test(j)) return true;
    if (/"(os\.\w+|data\.sql|phone\.\w+)"/.test(j) || /"container=(?!default")[^"]+"/i.test(j)) return true;
    return (j.match(/"agent\.task","value":"([\w.-]+)"/g) || []).some(m => this.private(this.get(m.match(/"value":"([\w.-]+)"/)[1]), depth + 1));
  },
  /** A request from one of this Mac's owner's own devices: one paired with it (pairing room, direct link, Tailscale), or
      a mesh member it lists as its owner's (Mesh.own); never because the request says so. */
  ownDevice(who) { if (!who) return false; if (/^(pair|direct|tailscale)$/.test(who.via)) return true; return who.via === 'mesh' && typeof Mesh !== 'undefined' && Mesh.own(who.meshId); },

  /* ---------- Waiting for the Mac (docs/studiogbee.html § 6) ---------- */
  WAIT_KINDS: [['mail', 'Email (Outlook)'], ['cal', 'Calendar'], ['teams', 'Teams'], ['slack', 'Slack'], ['whatsapp', 'WhatsApp'], ['web', 'Web and other'], ['acts', 'Anything that sends, replies or books']],
  /** Minutes a request may wait for its Mac to come online, per kind (0: don't wait, -1: until it does); ask: an acting one that waited asks again. */
  waitRules: () => ({ mail: 10, cal: 10, teams: 10, slack: 10, whatsapp: 10, web: 10, acts: 10, ask: true, ...store.get('waitRules', {}) }),
  waitKind(t) {
    if (t.wait) return t.wait; if (this.acts(t)) return 'acts';
    const k = { mail: 'mail', cal: 'cal', teams: 'teams', slack: 'slack', whatsapp: 'whatsapp' }[String(t.origId || t.id || '').split('.')[0]]; if (k) return k;
    const j = JSON.stringify(t.steps || []);
    return /\{teams/.test(j) ? 'teams' : /\{slack\}/.test(j) ? 'slack' : /\{whatsapp\}/.test(j) ? 'whatsapp' : /\{outlook\}[^"]*calendar/i.test(j) ? 'cal' : /\{outlook\}/.test(j) ? 'mail' : 'web';
  },
  waitLabel(m) { return m < 0 ? 'Until it’s back' : !m ? 'Don’t wait' : m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? 's' : ''}`; },
  /** Wait for an offline Mac (or StudioGen) as long as this kind of request may; true once it's back. */
  async wait(t, to, card) {
    const min = +this.waitRules()[this.waitKind(t)] || 0;
    if (!min) throw new Error(`${to.name} is offline right now. Is StudioGen open?`);
    const until = min < 0 ? Infinity : Date.now() + min * 60000, hm = min < 0 ? '' : new Date(until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (card) { this.post({ id: card, status: 'waiting', headline: `Waiting for ${to.name}: it’s offline${hm ? ` (until ${hm})` : ''}` }); Voice.respond(`${to.name} is offline. I’ll send it when it’s back${hm ? `, until ${hm}` : ''}.`); }
    Log.i('agent', `Waiting for ${to.name}`, { task: t.name, min });
    while (!to.ready()) { if (Date.now() > until) throw new Error(`${to.name} stayed offline, so I gave up on “${t.name}” (Agent › Library › Settings › Waiting requests)`); await new Promise(r => setTimeout(r, 2000)); }
    if (card) this.post({ id: card, status: 'running', headline: `Asking ${to.name}…` });
    return true;
  },
  /** Through StudioGBee (js/bee.js): the request waits there for the Mac (or StudioGen) as long as this kind may, and the
      answer comes back here, or onto its card later (Agent.late) if this screen has gone meanwhile. */
  async viaBee(t, to, params, o) {
    const min = +this.waitRules()[this.waitKind(t)] || 0;
    if (!min) throw new Error(`${to.name} is offline right now. Is StudioGen open?`);
    const ttl = min < 0 ? 7 * 86400000 : min * 60000, hm = min < 0 ? '' : new Date(Date.now() + ttl).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (o.card) { this.post({ id: o.card, status: 'waiting', headline: `Waiting at StudioGBee for ${to.name}${hm ? ` (until ${hm})` : ''}` }); Voice.respond(`${to.name} is offline. StudioGBee keeps your request until it’s back${hm ? `, until ${hm}` : ''}; you can close the app.`); }
    Log.i('agent', `Queued at StudioGBee for ${to.name}`, { task: t.name, min });
    const r = await Bee.call(to.meshId, 'task', { id: t.origId || t.id, params, confirmed: !!o.confirmed }, ttl, o.card ? { card: o.card, task: t.id, title: t.name } : {});
    if (r?.error) throw new Error(r.error); return r?.card ?? r;
  },
  /** An answer that came through StudioGBee after the screen that asked had gone (the app was closed or reloaded). */
  late(p, a) {
    const ok = !a.error, k = ok ? this.asCard(a.result?.card ?? a.result) : null;
    this.post({ id: p.card, task: p.task, title: p.title, ...(ok ? { ...k, status: 'done' } : { type: 'summary', status: 'failed', headline: a.error }), at: Date.now() });
    toast(`${p.title}: ${ok ? 'the answer came' : a.error}`); Log.i('agent', `Late answer for ${p.title}`, { ok });
  },
  /** After waiting, an acting task asks again: what was right ten minutes ago may not be now. */
  askAgain(t, params, to) {
    const what = (t.confirm || t.name).replace(/^\s*shall i\s+/i, '').replace(/\?\s*$/, '').replace(/\{(\w+)\}/g, (m, k) => params[k] ?? m);
    return new Promise(res => {
      const p = { at: Date.now(), yes: () => { clearInterval(keep); res(true); }, no: () => { clearInterval(keep); res(false); } };
      const keep = setInterval(() => { if (Commands.pending === p) p.at = Date.now(); else { clearInterval(keep); res(false); } }, 5000);
      Commands.pending = p; Voice.respond(`${to.name} is back. Shall I still ${what}? Say yes or no.`, null, { ask: true });
    });
  },
  params(t) { const p = { ...(t.params || {}) }; for (const e of t.examples || []) for (const m of e.matchAll(/\{(\w+)\}/g)) p[m[1]] ||= { ask: `What ${m[1]}?` }; return p; },

  /** What was said → { task, params }, by the tasks' example sentences: with {inputs}, the whole sentence must fit (the
      inputs keep their capitals); without, most of its words (as a script's loose phrases). The longest fit wins. */
  match(raw) {
    const said = String(raw).replace(/[’']/g, '').replace(/[^\p{L}\p{N}\s@.+]/gu, ' ').replace(/\s+/g, ' ').trim()
      .replace(/^(ok(ay)?|hey|so|please|can you|could you|would you|will you)\s+/i, '').replace(/[.\s]+$/, '').replace(/\s+please$/i, '');
    const t = plain(said); let best = null;
    for (const task of this.all()) for (const e of task.examples || []) {
      const slots = [...e.matchAll(/\{(\w+)\}/g)].map(m => m[1]), n = plain(e.replace(/\{\w+\}/g, ' ')).split(' ').filter(Boolean).length;
      let params = null, score = 0;
      if (slots.length) {
        const re = new RegExp('^' + plain(e.replace(/\{(\w+)\}/g, ' SLOT$1 ')).split(' ').map(w => /^slot\w+$/.test(w) ? '(.+?)' : w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+') + '$', 'i');
        const m = said.match(re); if (m) { params = Object.fromEntries(slots.map((k, i) => [k, m[i + 1].trim()])); score = n + 3; }
      } else if (Script.matchPhrase(e, t)) { params = {}; score = n + (plain(e) === t ? 3 : 0); }
      if (params && (!best || score > best.score)) best = { task, params, score, exact: !!slots.length || plain(e) === t }; // exact: one of its ways to ask, word for word
    }
    return best && best.score >= 2 ? best : null;
  },
  /** For Intent (js/brain.js): tasks as commands the model can pick, their inputs as slots. */
  catalog() {
    return this.all().map(t => ({ id: `task:${t.id}`, name: t.name, eg: (t.examples || []).slice(0, 2).map(e => e.replace(/\{(\w+)\}/g, '<$1>')), slots: Object.keys(this.params(t)),
      words: `${t.name} ${t.group || ''} ${(t.examples || []).join(' ')}`.toLowerCase() }));
  },

  /** Start a task from words or a tap: ask for missing inputs, ask before acting, then run (here or on the Mac). */
  async start(t, params = {}, o = {}) {
    if (typeof t === 'string') t = this.get(t); if (!t) return;
    const say = o.say || ((m, then, x) => Voice.respond(m, then, x));
    const P = this.params(t); params = { ...params };
    for (const [k, v] of Object.entries(params)) if (v == null || /^(none|null|n\/a)$/i.test(String(v).trim())) delete params[k];
    const need = Object.keys(P).find(k => (params[k] == null || params[k] === '') && !P[k].optional && P[k].default == null);
    if (need) {
      this.pend = { at: Date.now(), answer: raw => { params[need] = raw.replace(/[.!?]+$/, ''); this.start(t, params, o); } };
      Commands.pending = this.pend; return say(P[need].ask || `What ${need}?`, null, { ask: true });
    }
    for (const [k, v] of Object.entries(P)) if ((params[k] == null || params[k] === '') && v.default != null) params[k] = v.default.replace(/\{(\w+)\}/g, (m, x) => params[x] ?? '');
    // a task that asks in its own steps (agent.confirm, after reading something) isn't asked up front as well
    if (this.acts(t) && !o.confirmed && !this.trusted(t.id) && !(t.confirm === '' && JSON.stringify(t.steps || []).includes('"agent.confirm"'))) {
      const what = (t.confirm || t.name).replace(/^\s*shall i\s+/i, '').replace(/\?\s*$/, '').replace(/\{(\w+)\}/g, (m, k) => params[k] ?? m); // “Shall I” is added here
      const c = this.post({ task: t.id, title: t.name, type: 'question', headline: `Shall I ${what}?`, status: 'ask' });
      this.pend = { at: Date.now(), card: c.id, yes: always => { if (always) { this.trust(t.id, true); toast(`“${t.name}” is trusted from now on (Agent › Library to change)`); } this.drop(c.id); this.start(t, params, { ...o, confirmed: true }); }, no: () => this.drop(c.id) };
      Commands.pending = this.pend; return say(`Shall I ${what}? Say yes, or “yes, always”.`, null, { ask: true });
    }
    const c = this.post({ task: t.id, title: t.name, type: 'status', status: 'running', headline: this.asking(t) });
    Voice.show?.(t.name, this.asking(t));
    if (!o.quiet) Working.begin();
    try {
      const r = await this.exec(t, params, { confirmed: true, card: c.id });
      const done = this.post({ ...this.asCard(r), id: c.id, task: t.id, title: t.name, status: 'done', at: Date.now() });
      await Working.end(true);
      // presenting: the result as a card over the slides (private ones only when allowed), the presentation carries on
      if (done.type !== 'none' && typeof Peek !== 'undefined' && Peek.mode() === 'stage' && (settings.peekPrivate || !/^(Mail|Calendar|Messaging)$/.test(t.group || ''))) Peek.html(t.name, AgentHome.cardHtml(done, true));
      if (done.type !== 'none') say(this.spoken(done)); else this.drop(c.id);
      return r;
    } catch (e) {
      const signin = /^SIGNIN:/.test(e.message), msg = signin ? `Sign in to ${e.message.slice(7)} once in the agent browser on your Mac, then ask again.` : e.message;
      this.post({ id: c.id, task: t.id, title: t.name, type: 'summary', status: signin ? 'signin' : 'failed', headline: msg, at: Date.now() });
      Log.w('agent', `Task failed: ${t.name}`, { error: e.message }); await Working.end(false); say(msg);
    }
  },
  /** Run a task (inputs complete, confirmed) and give back its result card. */
  async exec(t, params, o = {}) {
    if (this.where(t) === 'mac' && !o.here) {
      const to = this.target(t);
      if (!to.ready()) {
        if (!to.paired) throw new Error('This needs StudioGen on your Mac: pair in Settings › Connections.');
        // a StudioGBee in the mesh keeps it while the app is closed (not something that sends and should be asked again)
        if (typeof Bee !== 'undefined' && Bee.up() && to.meshId && !(this.acts(t) && this.waitRules().ask)) return this.viaBee(t, to, params, o);
        await this.wait(t, to, o.card);
        if (this.acts(t) && this.waitRules().ask && !(await this.askAgain(t, params, to))) throw new Error('Okay, I didn’t.');
      }
      const r = await to.call({ id: t.origId || t.id, params, confirmed: !!o.confirmed });
      if (r?.error) throw new Error(r.error); return r?.card ?? r;
    }
    // never run with a needed input blank or unfilled (“{person}”): a send would go to whoever is first in the list
    for (const [k, d] of Object.entries(this.params(t))) { const v = String(params?.[k] ?? d.default ?? '').trim(); if (!d.optional && (!v || /^\{\w+\}$/.test(v))) throw new Error(`I need the ${k} for that`); }
    const prev = this.ctx, run = this.runner(t, params); if (prev?.check) run.ctx.check = true; // a check run carries into the tasks it runs
    // one task at a time in the agent browser (a composite's own tasks run inside it)
    const go = async () => { this.ctx = run.ctx; if (!prev) AgentWatch.begin(t); try { await run.steps(t.steps || [], { tok: 1 }); } finally { this.ctx = prev; if (!prev) AgentWatch.end(!run.ctx.failed, run.ctx.failed); } };
    if (prev || t.runs !== 'mac') await go(); else { const q = this.queue.then(go); this.queue = q.catch(() => {}); await q; }
    if (run.ctx.failed) throw new Error(run.ctx.failed);
    const res = t.result ? run.val(String(t.result).replace(/^\{|\}$/g, '')) : run.vars.card ?? run.vars.result;
    return res;
  },
  /** A script runner of its own (js/script.js's step engine), so a presentation that's running isn't touched. */
  runner(t, params) {
    const people = this.people(), vars = { ...params, ...this.sites() };
    for (const [k, v] of Object.entries(this.params(t))) if (v.type === 'person' && params[k]) {
      const q = plain(params[k]), p = people.find(x => plain(x.name) === q) || people.find(x => plain(x.name).split(' ')[0] === q.split(' ')[0]);
      const email = p?.email || (/@/.test(params[k]) ? params[k].trim() : ''), phone = (p?.phone || (/^\+?[\d\s()-]{7,}$/.test(params[k]) ? params[k] : '')).replace(/[^\d]/g, '');
      if (email) vars[`${k}_email`] = email; if (phone) vars[`${k}_phone`] = phone; // left unset when unknown: “{person_email} is empty”
      if (p) vars[k] = p.name;
    }
    const r = Object.assign(Object.create(Script), { cur: { name: t.name, intents: [], beats: [], end: { steps: [] } }, running: true, token: 1, vars, jobs: [], ask: null, busy: false, ctx: { task: t, vars }, paint() {}, remote: null });
    return r;
  },
  /** Whatever a task gave back → a card. */
  asCard(r) {
    if (r && typeof r === 'object' && !Array.isArray(r) && (r.headline || r.items || r.type)) return { type: r.type || (r.items?.length ? 'list' : 'summary'), headline: String(r.headline || ''), items: (r.items || []).slice(0, 8), value: r.value, unit: r.unit, place: r.place };
    if (Array.isArray(r)) return { type: 'list', headline: `${r.length} found`, items: r.slice(0, 8).map(x => ({ title: typeof x === 'object' ? Object.values(x).slice(0, 2).join(' · ') : String(x) })) };
    if (r == null || r === '') return { type: 'status', headline: 'Done' };
    return { type: 'summary', headline: String(r).slice(0, 400) };
  },
  /** A card as it's said: the headline, then up to five items (three while driving) as “who: the gist”, each a short sentence,
      and how many more are on the card. Links, long dates and pasted text read badly aloud, so they're tidied; times are
      said only where they matter (calendar, the car). */
  spoken(c) {
    if (c.say) return c.say;
    const all = c.items || [], max = AgentHome.moving() ? 3 : 5, withWhen = /^(cal|car)\./.test(c.task || '');
    const M = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const clean = t => String(t || '').replace(/https?:\/\/\S+|www\.\S+/g, 'a link').replace(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})\b/g, (m, d, mo) => (+d > 12 && M[+mo - 1] ? `${+d} ${M[+mo - 1]}` : m)).replace(/\s+/g, ' ').trim();
    const short = t => { t = clean(t); if (t.length <= 110) return t; const cut = t.slice(0, 110); return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 60))}…`; };
    const line = i => [short(i.title), withWhen && i.when ? clean(i.when) : '', short(i.detail)].filter(Boolean).join(withWhen ? ', ' : ': ');
    return [clean(c.headline), ...all.slice(0, max).map(line), all.length > max ? `And ${all.length - max} more on the card` : ''].filter(Boolean).join('. ').replace(/\.\s*\./g, '.').replace(/…\./g, '…');
  },
  /** On the Mac: a request to run a task of this library (asked and confirmed on the asking device). Its owner's own
      devices may run any (when allowed in Agent settings); other mesh members only shared tasks that need no sign-in. */
  async answer(p = {}, who) {
    const own = this.ownDevice(who);
    if (own && !this.cfg().remote) throw new Error('This Mac doesn’t run tasks for paired devices (Agent › Library)');
    const t = this.mine().find(x => x.id === p.id) || (own ? AGENT_TASKS.find(x => x.id === p.id) : null);
    if (!t) throw new Error(own ? 'That task isn’t in this Mac’s library' : 'That task isn’t shared by this Mac');
    if (!own && !t.share) throw new Error('That task isn’t shared by this Mac');
    if (!own && this.private(t)) throw new Error('That task uses this Mac’s sign-ins: only its owner’s devices may run it');
    if (this.acts(t) && !p.confirmed) throw new Error('That task acts for you: confirm it on the device first');
    const c = this.post({ task: t.id, title: `${t.name}${p.from ? ` · for ${p.from}` : ''}`, type: 'status', status: 'running', headline: 'Working on it…' });
    Working.begin({ silent: true }); // the phone says its line; here the assistant only works on it
    try { const r = await this.exec(t, p.params || {}, { confirmed: true, here: true }); const k = this.asCard(r); this.post({ ...k, id: c.id, status: 'done', at: Date.now() }); Working.end(true); return { card: k }; }
    catch (e) { Working.end(false); const signin = /^SIGNIN:/.test(e.message); this.post({ id: c.id, type: 'summary', status: signin ? 'signin' : 'failed', headline: signin ? `Sign in to ${e.message.slice(7)} in the agent browser` : e.message, at: Date.now() }); if (signin) AgentWeb.show(true); throw e; }
  },
  /** On the phone: the Mac's own tasks (names, examples, inputs), for matching and the model. */
  /** What the mesh's online StudioGens share, as their presence names it; meshStale: it changed since the last fetch. */
  meshHash() { return typeof Mesh === 'undefined' || !Mesh.m ? '' : JSON.stringify(Object.entries(Mesh.presence).filter(([, x]) => x.app === 'StudioGen' && Date.now() - x.at < 60000).map(([id, x]) => [id, x.caps?.agent || []])); },
  meshStale() { return this.meshHash() !== (this.meshSeen ?? ''); },
  async refresh(force) {
    if (force) { this.meshAt = 0; this.meshSeen = this.meshHash(); }
    if (!LINK_HOST && Link.ready()) try { const r = await Link.tasks(); if (Array.isArray(r?.tasks)) store.set('macTasks', r.tasks); } catch (e) { Log.d('agent', 'Mac tasks: not fetched', { error: e.message }); }
    // the other StudioGens in the mesh (at most once a minute): what each lets this device run; an offline one's are kept, to wait for it
    if (typeof Mesh === 'undefined' || !Mesh.m || Date.now() - (this.meshAt || 0) < 60000) return; this.meshAt = Date.now();
    const mac = typeof Relay !== 'undefined' ? Relay.mac()?.meshId : null, asked = new Set(), got = [];
    for (const [id, x] of Object.entries(Mesh.presence)) {
      if (id === Mesh._me?.id || id === mac || x.app !== 'StudioGen' || Date.now() - x.at > 60000) continue;
      try { const r = await Mesh.call(id, 'tasks', {}, 15000); asked.add(id); for (const t of r?.tasks || []) got.push({ ...t, id: `mesh:${id.slice(0, 8)}:${t.id}`, origId: t.id, on: id, onName: x.name, runs: 'mac', remoteOnly: true }); }
      catch (e) { Log.d('agent', `Mesh tasks: not fetched from ${x.name}`, { error: e.message }); }
    }
    store.set('meshTasks', [...this.meshMine().filter(t => !asked.has(t.on) && Mesh.member(t.on)), ...got]);
  },
  /** The tasks this Mac offers: for its owner's devices the ones made here; for others the shared ones that need no sign-in. */
  offered(own = true) {
    return this.mine().filter(t => own ? t.runs === 'mac' : t.share && !this.private(t))
      .map(t => ({ id: t.id, name: t.name, group: t.group, about: t.about, acts: t.acts, confirm: t.confirm, params: t.params, examples: t.examples, wait: this.waitKind(t) }));
  },

  /* ---------- The feed ---------- */
  feed: () => store.get('agentFeed', []),
  post(c) {
    const l = this.feed(), i = c.id ? l.findIndex(x => x.id === c.id) : -1;
    const n = i >= 0 ? { ...l[i], ...c } : { id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), at: Date.now(), where: this.where(this.get(c.task) || {}) === 'mac' ? 'mac' : 'here', ...c };
    if (i >= 0) l.splice(i, 1); l.unshift(n); store.set('agentFeed', l.slice(0, 40));
    AgentHome.draw(); return n;
  },
  drop(id) { store.set('agentFeed', this.feed().filter(x => x.id !== id)); AgentHome.draw(); },
};

// the mesh's StudioGens change what they share (their presence names it), or five minutes went by: fetch what they offer again
setInterval(() => { if (typeof Mesh !== 'undefined' && Mesh.m && (Agent.meshStale() || Date.now() - (Agent.meshAt || 0) > 300000)) Agent.refresh(true); }, 20000);

/* ---------- Actions: the agent's steps (also usable in any script) ---------- */
const agentArgs = args => { const o = { q: [], flags: [] }; for (const a of args || []) { const s = String(a), i = s.indexOf('='); if (s.startsWith('?') && i > 0) o.q.push([s.slice(1, i), s.slice(i + 1)]); else if (i > 0) o[s.slice(0, i).trim()] = s.slice(i + 1); else o.flags.push(s.trim()); } return o; };
const agentCtx = () => { const c = Agent.ctx; if (c?.failed) throw new Error(c.failed); return c; };
/** Agent steps: a failure stops the task with its reason (the script engine would carry on with the next step). */
const agentAction = (id, def) => Actions.define(id, { ...def, async run(...a) {
  let li = null;
  try { li = await AgentWatch.step(id, a[0], a[2]); const r = await def.run(...a);
    AgentWatch.done(li, true, typeof r === 'string' && id === 'agent.read' ? `${r.length} characters read` : id === 'ai.card' && r?.headline ? r.headline : ''); return r; }
  catch (e) { AgentWatch.done(li, false, e.message.replace(/^SIGNIN:(.+)$/, 'Sign in to $1 here, then ask again')); if (Agent.ctx) Agent.ctx.failed ||= e.message; throw e; } } });
/** A check run (an imported task, js/taskllm.js) of a task that acts: the step that would send, post or confirm only checks
    that its button or field is there. */
const checkOnly = (kind, v, a) => { const c = Agent.ctx; if (!c?.check || !c.task?.acts) return false;
  return kind === 'key' ? /enter/i.test(v || 'Enter') : kind === 'type' ? a.flags.includes('enter') : /send|post|reply|submit|save|delete|remove|book|pay|confirm|publish/i.test(`${v} ${a.sel || ''}`); };
const needWeb = () => { if (!AgentWeb.can()) throw new Error('This step needs StudioGen on a Mac (its agent browser)'); };
agentAction('agent.open', { group: 'Agent', name: 'Agent browser: open a page', arg: 'Web address; inputs: ?name=value (added to the address), wait=selector, site=name (to ask for a sign-in), ms=15000, container=name (else the site’s container)', async run(v, say, ev = {}) {
  agentCtx(); needWeb(); const a = agentArgs(ev.args), u = new URL(v);
  for (const [k, x] of a.q) if (x !== '') u.searchParams.set(k, x);
  await AgentWeb.go(u.href, a.container || Agent.ctx?.task?.container); // container=Work, or the task's own
  const site = a.site || u.hostname, here = () => AgentWeb.url();
  if (SIGNIN.test(here()) && !SIGNIN.test(u.href)) { AgentWeb.show(true); throw new Error(`SIGNIN:${site}`); }
  if (a.wait) {
    // wait in short turns, looking for a sign-in or refusal page in between, so it's caught in seconds, not after the full wait
    const total = +a.ms || 15000, t0 = Date.now(), BLOCKED = /works with google chrome|update (your )?browser|browser (is )?not supported|unsupported browser/i;
    let w = { ok: false };
    while (Date.now() - t0 < total) {
      w = await AgentWeb.call('waitFor', [{ sel: a.wait }, Math.min(3000, total - (Date.now() - t0))], 6000); if (w.ok) break;
      if (SIGNIN.test(here()) || (Date.now() - t0 > 4000 && (t => SIGNIN_WORDS.test(t) || BLOCKED.test(t))((await AgentWeb.call('read', ['body', 2500])).text || ''))) break;
    }
    if (!w.ok && !SIGNIN.test(here())) w = await AgentWeb.call('waitFor', [{ sel: a.wait }, 1500], 4000); // it may have just come
    if (!w.ok) {
      // the page never got ready: never carry on (the task would answer “Nothing”); show the agent browser and say why
      const txt = ((await AgentWeb.call('read', ['body', 2500])).text || '').slice(0, 2500);
      Log.w('agent', `The page didn’t show ${a.wait}`, { url: here(), text: txt.slice(0, 200) });
      AgentWeb.show(true);
      // a sign-in page, on any site: by its address, or by its words (WhatsApp's stays at web.whatsapp.com until linked)
      if (SIGNIN.test(here()) || SIGNIN_WORDS.test(txt)) throw new Error(`SIGNIN:${site}`);
      if (/works with google chrome|update (your )?browser|browser (is )?not supported|unsupported browser|switch to a supported browser/i.test(txt)) throw new Error(`${site} says this browser isn’t supported. Update StudioGen, then ask again.`);
      if (/are you a robot|not a robot|verify you are human|captcha|unusual traffic/i.test(txt)) throw new Error(`${site} wants to check you’re not a robot: answer it in the agent browser on your Mac, then ask again.`);
      throw new Error(`${site} didn’t open as expected. Have a look in the agent browser on your Mac (sign in if it asks), then ask again.`);
    }
  }
  if (SIGNIN.test(here()) && !SIGNIN.test(u.href)) { AgentWeb.show(true); throw new Error(`SIGNIN:${site}`); } // a sign-in page can pass for the page (an account list is a listbox too)
  return here();
} });
agentAction('agent.read', { group: 'Agent', name: 'Agent browser: read the page', arg: 'CSS selectors to read, tried in order (|| between them); the whole page if none fit; inputs: keep=words (only the lines that have them, || between choices), max=5000', async run(v, say, ev = {}) {
  agentCtx(); needWeb(); const a = agentArgs(ev.args), r = await AgentWeb.call('read', [v || 'body', +a.max || 5000]);
  // keep=Unread: the lines are picked here, not by the model (it lets read rows in)
  if (a.keep && r.text) { const ks = a.keep.toLowerCase().split('||').map(k => k.trim()).filter(Boolean); r.text = r.text.split('\n').filter(l => ks.some(k => l.toLowerCase().includes(k))).join('\n') || '(none)';
    const c = Agent.ctx; if (c) (c.kept ||= new Map()).set(r.text, r.text === '(none)' ? 0 : r.text.split('\n').length); } // how many lines were kept: the card's count (js ai.card)
  if (SIGNIN.test(r.url || '')) { AgentWeb.show(true); throw new Error(`SIGNIN:${new URL(r.url).hostname}`); }
  if (/unusual traffic|are you a robot|not a robot|verify you are human|captcha/i.test((r.text || '').slice(0, 800))) { AgentWeb.show(true); throw new Error('The site wants to check you’re not a robot: answer it in the agent browser on your Mac, then ask again.'); }
  Log.d('agent', `Read ${r.text?.length || 0} characters (${r.sel})`); return r.text || '';
} });
agentAction('agent.wait', { group: 'Agent', name: 'Agent browser: wait for something', arg: 'CSS selector; inputs: text=…, ms=…', async run(v, say, ev = {}) {
  agentCtx(); needWeb(); const a = agentArgs(ev.args); return (await AgentWeb.call('waitFor', [{ sel: v, text: a.text }, +a.ms || 10000], (+a.ms || 10000) + 3000)).ok;
} });
agentAction('agent.click', { group: 'Agent', name: 'Agent browser: click', arg: 'The text on it; inputs: sel=CSS selector (|| between choices), optional', async run(v, say, ev = {}) {
  agentCtx(); needWeb(); const a = agentArgs(ev.args); let r = { ok: false };
  const op = checkOnly('click', v, a) ? 'exists' : 'clickOn';
  for (const sel of (a.sel ? a.sel.split('||') : [''])) { r = await AgentWeb.call(op, [{ sel: sel || undefined, text: v || undefined }]); if (r.ok) { AgentWatch.ring(r.rect); break; } }
  if (!r.ok && !a.flags.includes('optional')) throw new Error(r.error || `Couldn’t click ${v || a.sel}`);
  return r.ok;
} });
agentAction('agent.type', { group: 'Agent', name: 'Agent browser: type into a field', arg: 'The field’s label or placeholder; inputs: the text, then enter (to press Enter), sel=CSS selector', async run(v, say, ev = {}) {
  agentCtx(); needWeb(); const a = agentArgs(ev.args), text = a.flags.find(f => f !== 'enter') ?? '';
  let r = { ok: false };
  for (const sel of (a.sel ? a.sel.split('||') : [''])) { r = await AgentWeb.call('focus', [{ sel: sel || undefined, label: v }]); if (r.ok) { AgentWatch.ring(r.rect); break; } }
  if (!r.ok) throw new Error(r.error || `No field ${v}`);
  if (checkOnly('type', v, a)) return true; // a check run: the message box is there, nothing typed or sent
  if (text) await AgentWeb.insert(text);
  if (a.flags.includes('enter')) { await new Promise(x => setTimeout(x, 200)); AgentWeb.key('Enter'); }
  return true;
} });
agentAction('agent.key', { group: 'Agent', name: 'Agent browser: press a key', arg: 'Enter, Escape, Tab…; inputs: sel=field to focus first', async run(v, say, ev = {}) {
  agentCtx(); needWeb(); const a = agentArgs(ev.args); if (a.sel) await AgentWeb.call('focus', [{ sel: a.sel.split('||')[0], clear: false }]); if (!checkOnly('key', v, a)) AgentWeb.key(v || 'Enter'); return true;
} });
Actions.define('agent.show', { group: 'Agent', name: 'Show the agent browser (to sign in)', arg: '', run: () => { needWeb(); AgentWeb.show(true); } });
/** A yes/no in the middle of a task, after it has read something (“Priya said … Send ‘on my way’?”): no stops the task.
    A check run and a trusted task (“yes, always”) carry on without asking. */
agentAction('agent.confirm', { group: 'Agent', name: 'Ask yes or no before going on', arg: 'The question (values the task read allowed)', run(v) {
  const c = agentCtx(); if (!c || c.check || Agent.trusted(c.task?.id)) return true;
  return new Promise(res => {
    const p = { at: Date.now(), yes: always => { clearInterval(keep); if (always) Agent.trust(c.task.id, true); res(true); }, no: () => { clearInterval(keep); c.failed ||= 'Okay, I didn’t.'; res(false); } };
    const keep = setInterval(() => { if (Commands.pending === p) p.at = Date.now(); else { clearInterval(keep); if (!c.failed) { c.failed = 'No answer, so I stopped.'; res(false); } } }, 5000); // kept open while you think
    Commands.pending = p; Voice.respond(`${v} Say yes or no.`, null, { ask: true });
  });
} });
Actions.define('agent.fail', { group: 'Agent', name: 'Stop the task with a message', arg: 'What to say', run(v) { const c = Agent.ctx; if (c) c.failed ||= v || 'That didn’t work.'; else throw new Error(v); } });
Actions.define('agent.task', { group: 'Agent', name: 'Run another task', arg: 'Task id; inputs: name=value', async run(v, say, ev = {}) {
  agentCtx(); const t = Agent.get(v); if (!t) throw new Error(`No task ${v}`);
  const a = agentArgs(ev.args); delete a.q; delete a.flags;
  const c = Agent.post({ task: t.id, title: t.name, type: 'status', status: 'running', headline: Agent.asking(t) });
  try { const r = await Agent.exec(t, a, { confirmed: true }); const k = Agent.post({ ...Agent.asCard(r), id: c.id, status: 'done', at: Date.now() }); Voice.respond(Agent.spoken(k)); return k; }
  catch (e) { Agent.drop(c.id); if (Agent.ctx) Agent.ctx.failed ||= e.message; throw e; } // the task that ran it reports why
} });
Actions.define('agent.scripts', { group: 'Agent', name: 'The scripts I can present (a card)', arg: '', run: () => ({ type: 'list', headline: `${Scripts.all().length} scripts`, items: Scripts.all().slice(0, 8).map(s => ({ title: s.name, detail: s.json?.about || '' })) }) });
/** The model's card: { headline, items: [{ title, detail, when, place, person }] } from the page text. */
const CARD_SCHEMA = { type: 'object', required: ['headline', 'items'], properties: {
  headline: { type: 'string', description: 'one short sentence a driver can take in at a glance' },
  items: { type: 'array', description: 'at most five', items: { type: 'object', required: ['title', 'detail'], properties: {
    title: { type: 'string', description: 'under eight words' }, detail: { type: 'string', description: 'what the request says this item\'s detail holds, in one short line' },
    when: { type: 'string', description: 'a time or date from the text for this item, else empty' }, place: { type: 'string', description: 'a room, address or “online”, else empty' },
    person: { type: 'string', description: 'the person concerned (sender, organiser), else empty' } } } } } };
/** Empty fields dropped (a step's “{x.items.0.place} is empty” then holds), at most five items. */
/** The small model sometimes answers with the request's own words (“how many chats are unread”): then the headline is made from the items. */
const echoFix = (c, ask) => { const w = plain(c.headline).split(' ').filter(x => x.length > 3), q = ` ${plain(ask)} `;
  if (c.items.length && w.length && w.filter(x => q.includes(` ${x} `)).length / w.length >= 0.6) { const t = c.items.map(i => i.title).filter(Boolean).slice(0, 4); c.headline = t.length > 1 ? `${t.slice(0, -1).join(', ')} and ${t.at(-1)}` : t[0] || c.headline; }
  return c; };
const tidyCard = j => ({ ...j, headline: String(j.headline || ''), items: (Array.isArray(j.items) ? j.items : []).slice(0, 5).map(i => Object.fromEntries(Object.entries(i || {}).filter(([, x]) => x && !/^(none|n\/a|empty|unknown)$/i.test(String(x).trim())))) });
agentAction('ai.card', { group: 'Agent', name: 'Make a card from text (the model)', arg: 'What to pull out; input: the text ({read})', async run(v, say, ev = {}) {
  agentCtx(); const text = String((ev.args || [])[0] ?? '').slice(0, 5000);
  if (text.trim() === '(none)') return { headline: 'Nothing', items: [] }; // agent.read's keep= found no lines
  if (/^\{read\}$/.test(text.trim()) || (ev.args?.length && text.trim().length < 40 && !/^(Topic|Meeting):/.test(text))) return { headline: 'I couldn’t read anything on that page', items: [] };
  // the small on-device model copies whatever it is given (today's date went into every “when”), so the date only comes with requests about dates
  const dated = /\b(today|tomorrow|yesterday|this week|next week|date|day|calendar|meeting|deadline|due)\b/i.test(v);
  const instructions = `You turn text taken from a web page or app (mail, calendar, chats, search results) into a short result card for someone who may be driving. Follow the request: it says what the headline and each item's title, detail and when hold. Rules: use only facts that are in the text; never invent names, numbers, dates or times; the request's words describe what to write, they are not values; write each field in your own short words, never copy whole lines; leave when empty unless the text gives a time for that item. If the text doesn't answer the request, the headline says so and items is empty. Plain words, no markdown.${dated ? ` Today is ${new Date().toDateString()}.` : ''}`;
  // lines picked by agent.read keep=: their number is known, so the model is told it and its headline's number is put right
  const n = Agent.ctx?.kept?.get(text.trim()) ?? Agent.ctx?.kept?.get(text);
  const prompt = `Request: ${v}${n != null ? `\n\nThere are exactly ${n} of them, one per line.` : ''}\n\nText:\n${text || '(none)'}`;
  const counted = c => { if (n != null && c?.headline) c.headline = c.headline.replace(/^\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i, String(n)); return c; };
  if (typeof MacAI !== 'undefined' && MacAI.can()) {
    try { const r = await MacAI.ask({ instructions, prompt, schema: CARD_SCHEMA, temperature: 0.2, max: 500 }); return counted(echoFix(tidyCard(JSON.parse(r.json || '{}')), v)); }
    catch (e) { Log.w('agent', 'The on-device model didn’t make the card', { error: e.message }); }
  }
  if (typeof Brain !== 'undefined' && Brain.ready() && Brain.cfg().provider !== 'mac') {
    const t = await Brain.complete(`${instructions} Answer only with JSON: {"headline": "...", "items": [{"title": "...", "detail": "..."}]}`, prompt, 500);
    try { return counted(tidyCard(JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)))); } catch { return { headline: t.slice(0, 300), items: [] }; }
  }
  const lines = text.split('\n').map(x => x.trim()).filter(Boolean);
  return { headline: lines.length ? `No model here to sum this up (Apple’s on-device model on your Mac, or Settings › Assistant). What I found:` : 'Nothing found', items: lines.slice(0, 5).map(l => ({ title: l.slice(0, 90) })) };
} });
/** Cards put together without the model (it gets totals wrong): one item per source with its count and names. */
agentAction('card.join', { group: 'Agent', name: 'Put cards together (one line per source)', arg: 'The headline (empty: the counts); inputs: Label=card name, one per source', run(v, say, ev = {}) {
  const vars = agentCtx()?.vars || {}, parts = (ev.args || []).map(a => String(a).match(/^(.+?)=\{?([\w.]+)\}?$/)).filter(Boolean);
  const items = parts.map(([, label, name]) => { const c = name.split('.').reduce((o, k) => o?.[k], vars), list = Array.isArray(c?.items) ? c.items : [];
    // a part that is itself put together (its items carry counts): its lines and their sum
    const joined = c?.type === 'summary' && list.length && list.every(i => /^\d+$/.test(i.when || ''));
    return { title: label.trim(), detail: joined ? list.map(i => `${i.when} ${i.title}`).join(', ') : list.length ? list.map(i => i.title).filter(Boolean).join(', ') : c?.headline || 'nothing', when: String(joined ? list.reduce((n, i) => n + +i.when, 0) : list.length) }; });
  const head = items.map(i => `${i.when} ${i.title}`).join(', ');
  return { type: 'summary', headline: v || (items.every(i => i.when === '0') ? 'Nothing new' : head), items: items.slice(0, 5) };
} });
agentAction('ai.when', { group: 'Agent', name: 'A spoken time → start and end (the model)', arg: 'The time as said (“tomorrow at 3 for an hour”)', async run(v) {
  agentCtx(); const now = new Date(), pad = n => String(n).padStart(2, '0'), iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
  if (typeof MacAI !== 'undefined' && MacAI.can()) {
    try { const r = await MacAI.ask({ instructions: `Turn a spoken time into a start and end in local time, format YYYY-MM-DDTHH:MM:00. Now is ${iso(now)} (${now.toLocaleDateString([], { weekday: 'long' })}). No length given: one hour.`, prompt: v, schema: { type: 'object', required: ['start', 'end'], properties: { start: { type: 'string' }, end: { type: 'string' } } }, temperature: 0, max: 80 }); const j = JSON.parse(r.json || '{}'); if (/^\d{4}-\d\d-\d\dT/.test(j.start)) return j; } catch {}
  }
  const d = new Date(now.getTime() + 3600000); d.setMinutes(0, 0, 0); return { start: iso(d), end: iso(new Date(d.getTime() + 3600000)) };
} });
/* The car's own steps */
Actions.define('car.park', { group: 'Agent', name: 'Remember the parking spot', arg: 'A note (level, pillar)', run(v) {
  const p = { lat: loc.lat, lon: loc.lon, at: Date.now(), note: v || '', real: loc.source !== 'none' }; store.set('parkedAt', p);
  return { type: 'place', headline: `Parked ${new Date(p.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${v ? `: ${v}` : ''}`, items: [], place: { lat: p.lat, lon: p.lon, name: 'Your car' } };
} });
Actions.define('car.findcar', { group: 'Agent', name: 'Where the car is parked', arg: '', run() {
  const p = store.get('parkedAt', null); if (!p) return { type: 'summary', headline: 'I haven’t saved a parking spot. Say “remember where I parked” next time.' };
  const R = 6371000, dl = (p.lat - loc.lat) * Math.PI / 180, dn = (p.lon - loc.lon) * Math.PI / 180, a = Math.sin(dl / 2) ** 2 + Math.cos(loc.lat * Math.PI / 180) * Math.cos(p.lat * Math.PI / 180) * Math.sin(dn / 2) ** 2, m = 2 * R * Math.asin(Math.sqrt(a));
  return { type: 'place', headline: `Your car is ${m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`} away${p.note ? `, ${p.note}` : ''}`, items: [{ title: `Parked ${new Date(p.at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` }], place: { lat: p.lat, lon: p.lon, name: 'Your car' } };
} });
Actions.define('car.eta', { group: 'Agent', name: 'Arrival time on the route', arg: '', run() {
  const v = typeof nav !== 'undefined' && nav?.view; if (!v) return { type: 'summary', headline: 'No route right now' };
  const mins = Math.max(1, Math.round(v.remainT / 60));
  return { type: 'number', headline: `Arriving ${v.eta.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}, ${mins} min to go`, value: v.eta.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), unit: `${mins} min · ${nav.dest?.name || ''}` };
} });

/* ---------- The Agent screen (Home in the car): results, suggestions, the library ---------- */
const AgentHome = {
  show() { this.draw(); Agent.refresh(); },
  moving: () => (loc.speed || 0) > 2.2,
  suggestions() {
    const h = new Date().getHours(), ids = h < 11 ? ['car.commute', 'cal.today', 'mail.urgent', 'whatsapp.read'] : h < 17 ? ['cal.next', 'mail.unread', 'teams.read', 'slack.mentions'] : ['mail.unread', 'whatsapp.read', 'web.news', 'car.findcar'];
    return ids.map(id => Agent.get(id)).filter(Boolean);
  },
  cardHtml(c, big) {
    const max = this.moving() ? 3 : big ? 6 : 3, icon = { running: '⏳', waiting: '🕓', ask: '❓', signin: '🔑', failed: '⚠️' }[c.status] || { place: '📍', number: '⏱', status: '✓' }[c.type] || '';
    const items = (c.items || []).slice(0, max).map(i => `<li><b>${esc(i.title || '')}</b>${i.when ? ` <span class="ag-when">${esc(i.when)}</span>` : ''}${i.detail && !this.moving() ? `<div class="ag-detail">${esc(i.detail)}</div>` : ''}</li>`).join('');
    const btns = c.status === 'ask' ? `<div class="ag-btns"><button class="big-btn accent" data-ag="yes:${c.id}">Yes</button><button class="big-btn" data-ag="always:${c.id}">Yes, always</button><button class="big-btn" data-ag="no:${c.id}">No</button></div>`
      : c.status === 'signin' && AgentWeb.can() ? `<div class="ag-btns"><button class="big-btn accent" data-ag="signin:${c.id}">Open the agent browser</button><button class="big-btn" data-ag="retry:${c.id}">Try again</button></div>`
      : c.status === 'failed' ? `<div class="ag-btns"><button class="big-btn" data-ag="retry:${c.id}">Try again</button></div>`
      : c.place?.lat || (/^(cal|car)\./.test(c.task || '') && (c.items || []).some(i => i.place && !/online|teams|zoom/i.test(i.place))) ? `<div class="ag-btns"><button class="big-btn accent" data-ag="go:${c.id}">${svg('maps')} Go there</button></div>` : '';
    return `<article class="ag-card ${big ? 'big' : ''} ${c.status || ''}" data-ag="say:${c.id}">
      <div class="ag-top"><span class="ag-task">${icon} ${esc(c.title || '')}${c.where === 'mac' ? ' · Mac' : ''}</span><span class="ag-at">${esc(new Date(c.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}</span>
        <button class="ag-x" data-ag="drop:${c.id}" aria-label="Remove">${svg('close')}</button></div>
      ${c.type === 'number' && c.value ? `<div class="ag-value">${esc(c.value)}<small>${esc(c.unit || '')}</small></div>` : ''}
      <h3 class="ag-head">${esc(c.headline || '')}</h3>${items ? `<ul class="ag-items">${items}</ul>` : ''}${btns}</article>`;
  },
  /** The assistant beside the cards on a wide screen (the watch panel takes the right): Stage's character, head to toe,
      moved in like the start page does and handed back on leaving. Not on a phone, nor while driving. */
  avatarSide() { return innerWidth >= 900 && !this.moving() && typeof StartPage !== 'undefined' && typeof Media !== 'undefined'; },
  draw() {
    const root = $('#agentRoot'); if (!root || current !== 'agent') return;
    const feed = Agent.feed(), [top, ...rest] = feed, hello = (h => h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening')(new Date().getHours());
    const side = this.avatarSide(), id = side ? StartPage.avatarId() : '';
    if (side && !$('.ag-avatar', root)) { root.innerHTML = `<aside class="ag-avatar mw" data-media="${esc(id)}"><div class="mw-body"></div></aside><div class="ag-main"></div>`; root.classList.add('ag-has-av');
      Media.mount(id, $('.ag-avatar', root)).then(() => { this.av = id; this.frame(true); }).catch(() => {}); }
    else if (!side && $('.ag-avatar', root)) { this.giveBack(); root.innerHTML = ''; root.classList.remove('ag-has-av'); }
    (side ? $('.ag-main', root) : root).innerHTML = `<header class="ag-hdr"><div><h1>${hello}</h1><p class="se-note">${this.moving() ? 'Driving: short cards, read aloud.' : `Ask by voice or type. ${AgentWeb.can() ? 'Tasks run on this Mac.' : Link.ready() ? `Mail, calendar and chats run on ${esc(Link.macName())}.` : 'Pair with your Mac for mail, calendar and chats.'}`}</p></div>
      <button class="chip" data-ag="lib">${svg('grid')} Library</button></header>
      <form class="ag-ask" data-agform><input id="agAsk" placeholder="Ask, e.g. “what’s my day?”" autocomplete="off" enterkeyhint="go"><button class="big-btn accent" aria-label="Ask">${svg('mic')}</button></form>
      <div class="ag-sugg">${this.suggestions().map(t => `<button class="chip" data-ag="run:${esc(t.id)}">${esc(t.name)}</button>`).join('')}</div>
      ${top ? this.cardHtml(top, true) : `<div class="ag-empty"><h3>Nothing yet</h3><p class="se-note">Results of what you ask show here: mail summaries, your day, messages, arrival times, tasks on your Mac.</p></div>`}
      <div class="ag-list">${(this.moving() ? rest.slice(0, 2) : rest.slice(0, 12)).map(c => this.cardHtml(c)).join('')}</div>`;
  },
  /** Head to toe in a tall, narrow column (the start page's framing leaves room for the arms, which makes her small here). */
  frame(on) { const i = typeof VrmAvatar !== 'undefined' && VrmAvatar.all.get(this.av); if (i) { i.fullBody = on; i.wide = false; i.frame(); } },
  /** Leaving the Agent screen: the assistant goes back to its Stage widget (the start page takes it itself). */
  giveBack(to) {
    const id = this.av; if (!id) return; this.frame(false); this.av = null;
    if (to !== 'start' && $(`#dashRoot .mw[data-media="${CSS.escape(id)}"]`)) Media.mount(id).catch(() => {});
  },
  /* The library: every task, run, trust, add your own */
  lib(group) {
    const all = Agent.all(), groups = [...new Set(all.map(t => t.group || 'Mine'))];
    const row = t => `<div class="ag-row"><div class="ag-row-main"><b>${esc(t.name)}</b> ${t.acts ? '<span class="ag-tag">acts</span>' : ''}${t.runs === 'mac' ? '<span class="ag-tag">Mac</span>' : ''}${Agent.trusted(t.id) ? '<span class="ag-tag on">trusted</span>' : ''}
      <div class="se-note">“${esc((t.examples || [])[0] || '')}”${t.about ? ` · ${esc(t.about)}` : ''}</div></div>
      <button class="chip" data-ag="run:${esc(t.id)}">Run</button>${Agent.acts(t) ? `<button class="chip" data-ag="trust:${esc(t.id)}">${Agent.trusted(t.id) ? 'Ask first' : 'Trust'}</button>` : ''}${Agent.mine().some(x => x.id === t.id) ? `<button class="chip" data-ag="edit:${esc(t.id)}">Edit</button>` : ''}</div>`;
    sheet('Task library', `<p class="se-note">Say a task in your own words, or tap Run. Tasks that act for you (send, book) are asked first, unless trusted. Tasks marked Mac use the agent browser on your Mac, signed in to Outlook, Teams, Slack and WhatsApp on the web.</p>
      <div class="chip-row">${groups.map(g => `<button class="chip ${g === group ? 'accent' : ''}" data-ag="grp:${esc(g)}">${esc(g)}</button>`).join('')}</div>
      <div class="ag-lib">${all.filter(t => !group || (t.group || 'Mine') === group).map(row).join('')}</div>
      <div class="chip-row"><button class="chip accent" data-ag="new">+ New task</button><button class="chip" data-ag="people">People</button><button class="chip" data-ag="cfg">Settings</button>${AgentWeb.can() ? '<button class="chip" data-ag="browser">Agent browser (sign in)</button>' : ''}</div>`, [['Close']]);
  },
  people() {
    const l = Agent.people();
    sheet('People', `<p class="se-note">Names you say, with the email (mail, Teams) and number (WhatsApp, with country code) to use. Kept on this device.</p>
      <div id="agPeople">${[...l, { name: '', email: '', phone: '' }].map(p => `<div class="se-row ag-person"><input placeholder="Name" value="${esc(p.name)}" data-k="name"><input placeholder="email@work.com" value="${esc(p.email || '')}" data-k="email" autocapitalize="off"><input placeholder="+91 98…" value="${esc(p.phone || '')}" data-k="phone" inputmode="tel"></div>`).join('')}</div>
      <button class="chip" data-ag="addperson">+ Another</button>`,
      [['Save', () => { const ps = $$('#agPeople .ag-person').map(r => Object.fromEntries($$('input', r).map(i => [i.dataset.k, i.value.trim()]))).filter(p => p.name); store.set('agentPeople', ps); toast('Saved'); }], ['Cancel']]);
  },
  cfg() {
    const c = Agent.cfg();
    sheet('Agent settings', `<label class="se-field"><span>Outlook on the web</span><select id="agOl">${[['https://outlook.office.com', 'Work or school (outlook.office.com)'], ['https://outlook.live.com', 'Personal (outlook.live.com)']].map(([u, l]) => `<option value="${u}" ${c.outlook === u ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="se-check"><input type="checkbox" id="agPractice" ${c.practice ? 'checked' : ''}> Use the practice sites (made-up mail, Slack, WhatsApp and Teams, to try and test tasks safely)</label>
      ${AgentWeb.can() ? `<label class="se-check"><input type="checkbox" id="agWatch" ${c.watch ? 'checked' : ''}> Show the browser while tasks run (watch each step, to see why one doesn’t work)</label>
      <label class="se-check"><input type="checkbox" id="agStep" ${c.stepMode ? 'checked' : ''}> One step at a time (pauses before each step until you tap Next step)</label>` : ''}
      ${LINK_HOST ? `<label class="se-check"><input type="checkbox" id="agRemote" ${c.remote ? 'checked' : ''}> Paired phones may run this Mac’s tasks (acting ones are confirmed on the phone)</label>` : ''}
      ${AgentWeb.can() ? `<div class="chip-row"><button class="chip" data-ag="containers">Containers and sign-ins (${Containers.all().length})</button></div>` : ''}
      <p class="se-note">Trusted tasks (run without asking): ${store.get('taskTrust', []).map(id => esc(Agent.get(id)?.name || id)).join(', ') || 'none'}.</p>
      ${this.waitHtml()}`,
      [['Save', () => { store.set('agentCfg', { ...c, outlook: $('#agOl').value, remote: $('#agRemote') ? $('#agRemote').checked : c.remote, watch: $('#agWatch') ? $('#agWatch').checked : c.watch, practice: $('#agPractice').checked, stepMode: $('#agStep') ? $('#agStep').checked : c.stepMode }); this.waitSave(); toast('Saved'); }], ['Close']]);
  },
  /** Waiting requests (Agent.waitRules): how long each kind may wait for an offline Mac or StudioGen. */
  waitHtml() {
    const w = Agent.waitRules(), opts = v => [0, 1, 5, 10, 30, 60, 240, -1].map(m => `<option value="${m}" ${+v === m ? 'selected' : ''}>${Agent.waitLabel(m)}</option>`).join('');
    return `<p class="se-note"><b>Waiting requests</b> · when the Mac (or StudioGen) a request is for is offline, it waits on this device while ${APP_NAME} is open, then runs when it's back.</p>
      <div class="ag-wait">${Agent.WAIT_KINDS.map(([k, l]) => `<label class="se-row"><span>${esc(l)}</span><select data-agwait="${k}">${opts(w[k])}</select></label>`).join('')}</div>
      <label class="se-check"><input type="checkbox" id="agWaitAsk" ${w.ask ? 'checked' : ''}> Ask again before sending something that waited</label>`;
  },
  waitSave() { if (!$('[data-agwait]')) return; const w = { ask: !!$('#agWaitAsk')?.checked }; for (const el of $$('[data-agwait]')) w[el.dataset.agwait] = +el.value; store.set('waitRules', w); },
  /** Containers, like Firefox's (js/media.js Containers, desktop/browse.js): each keeps its own sign-ins; sites go into one. */
  containers() {
    sheet('Containers and sign-ins', `<p class="se-note">Like Firefox containers: each keeps its own sign-ins, so a work and a personal account of the same site can both stay signed in. Put sites in a container, one a line (<code>outlook.office.com</code>); a site in none opens in Default. A task can also name its container. Sign-ins are kept when StudioGen restarts or updates.</p>
      <div id="ctList">${Containers.all().map(c => this.ctRow(c)).join('')}</div>
      <div class="chip-row"><button class="chip" data-ag="ctadd">+ Container</button></div>`,
      [['Save', () => { this.ctSave(); toast('Containers saved'); }], ['Cancel']]);
  },
  ctRow(c) {
    return `<div class="ct-row" data-ct="${esc(c.id)}"><div class="ct-head"><input type="color" value="${esc(c.color)}" data-k="color" aria-label="Colour"><input type="text" value="${esc(c.name)}" data-k="name" aria-label="Name">
      <button class="chip" data-ag="ctsign:${esc(c.id)}">Sign in…</button><button class="chip" data-ag="ctforget:${esc(c.id)}">Forget sign-ins</button>${c.id === 'browse' ? '' : `<button class="chip" data-ag="ctdel:${esc(c.id)}" aria-label="Delete ${esc(c.name)}">${svg('close')}</button>`}</div>
      <textarea data-k="sites" placeholder="Sites, one a line: outlook.office.com">${esc(Containers.sites(c.id).join('\n'))}</textarea></div>`;
  },
  ctSave() {
    const rows = $$('#ctList .ct-row'); if (!rows.length) return;
    const list = rows.map(r => ({ id: r.dataset.ct, name: $('[data-k="name"]', r).value.trim() || 'Container', color: $('[data-k="color"]', r).value }));
    const rules = {}; for (const r of rows) for (const d of $('[data-k="sites"]', r).value.split(/[\n,\s]+/).map(x => x.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/?#].*$/, '').replace(/^www\./, '')).filter(Boolean)) rules[d] = r.dataset.ct;
    store.set('containers', list); store.set('containerSites', rules);
    if (AgentWeb.box) AgentWeb.use(AgentWeb.cur); // the bar's name and colour
  },
  /** Your own task: a web page and a question, a script, or other tasks in order (a composite). */
  edit(id) {
    const t = id ? Agent.mine().find(x => x.id === id) : null, k = t?.kind || 'web', f = t?.form || {};
    const tasks = Agent.all().filter(x => x.id !== id).map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');
    sheet(t ? 'Edit task' : 'New task', `<label class="se-field"><span>Name</span><input id="agN" value="${esc(t?.name || '')}" placeholder="Check my order"></label>
      <label class="se-field"><span>Ways to ask (one per line; {words} in braces become inputs)</span><textarea id="agE" rows="3" placeholder="check my order {order}&#10;where is order {order}">${esc((t?.examples || []).join('\n'))}</textarea></label>
      <label class="se-field"><span>What it does</span><select id="agK">${[['web', 'Read a web page and answer'], ['composite', 'Run tasks in order (a composite)'], ['script', 'Run one of my scripts'], ['json', 'Steps as JSON (advanced)']].map(([v, l]) => `<option value="${v}" ${k === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <div data-agk="web" ${k === 'web' ? '' : 'hidden'}><label class="se-field"><span>Web address ({words} allowed)</span><input id="agU" value="${esc(f.url || '')}" placeholder="https://example.com/orders/{order}" autocapitalize="off"></label>
        <label class="se-field"><span>What to tell you</span><input id="agQ" value="${esc(f.ask || '')}" placeholder="the status of order {order} and when it arrives"></label>
        <label class="se-check"><input type="checkbox" id="agMac" ${t?.runs !== 'here' ? 'checked' : ''}> On my Mac (signed-in sites, any page)</label></div>
      <div data-agk="composite" ${k === 'composite' ? '' : 'hidden'}><p class="se-note">Tasks run one after the other, each result shown as its own card. Inputs with the same name are passed on.</p>
        <div id="agC">${(f.tasks || ['']).map(x => `<select class="se-wz-in" data-agc>${`<option value="">(none)</option>${tasks}`.replace(`value="${esc(x)}"`, `value="${esc(x)}" selected`)}</select>`).join('')}</div><button class="chip" data-ag="addstep">+ Another task</button></div>
      <div data-agk="script" ${k === 'script' ? '' : 'hidden'}><label class="se-field"><span>Script</span><select id="agS">${Scripts.all().map(s => `<option ${f.script === s.name ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label></div>
      <div data-agk="json" ${k === 'json' ? '' : 'hidden'}><textarea id="agJ" rows="8" class="se-json">${esc(JSON.stringify(t?.steps || [], null, 1))}</textarea></div>
      <label class="se-check"><input type="checkbox" id="agA" ${t?.acts ? 'checked' : ''}> It acts for me (sends, books, buys): ask before running</label>`,
      [['Save', () => this.save(id)], ...(t ? [['Delete', () => { Agent.del(id); toast('Deleted'); }]] : []), ['Cancel']]);
  },
  save(id) {
    const name = $('#agN').value.trim(), examples = $('#agE').value.split('\n').map(x => x.trim()).filter(Boolean), kind = $('#agK').value;
    if (!name || !examples.length) return toast('A name and at least one way to ask, please');
    let steps, runs = 'here', form = {};
    if (kind === 'web') {
      form = { url: $('#agU').value.trim(), ask: $('#agQ').value.trim() }; if (!/^https?:\/\//.test(form.url)) return toast('The web address should start with https://');
      runs = $('#agMac').checked ? 'mac' : 'here';
      steps = [{ do: 'agent.open', value: form.url, args: ['wait=body'] }, { do: 'wait', value: '2' }, { do: 'agent.read', value: 'main||body', as: 'read' }, { do: 'ai.card', value: `Tell me ${form.ask}`, args: ['{read}'], as: 'card' }];
    } else if (kind === 'composite') {
      form = { tasks: $$('[data-agc]').map(s => s.value).filter(Boolean) }; if (!form.tasks.length) return toast('Pick at least one task');
      const ins = [...new Set(examples.flatMap(e => [...e.matchAll(/\{(\w+)\}/g)].map(m => m[1])))];
      steps = [...form.tasks.map(x => ({ do: 'agent.task', value: x, args: ins.filter(i => Agent.params(Agent.get(x) || {})[i]).map(i => `${i}={${i}}`) })), { set: 'card', value: '{"type":"none"}' }];
    } else if (kind === 'script') { form = { script: $('#agS').value }; runs = 'mac'; steps = [{ do: 'script.run', value: form.script }, { set: 'card', value: `{"type":"status","headline":"Running ${form.script.replace(/"/g, '')}"}` }]; }
    else { try { steps = JSON.parse($('#agJ').value); if (!Array.isArray(steps)) throw 0; } catch { return toast('The steps should be a JSON list'); } runs = /"agent\./.test(JSON.stringify(steps)) ? 'mac' : 'here'; }
    Agent.put({ id: id || `my.${Date.now().toString(36)}`, name, group: 'Mine', kind, form, examples, runs, acts: $('#agA').checked, steps });
    toast('Saved: say it, or find it in the library'); Agent.refresh();
  },
};
document.addEventListener('click', e => {
  const b = e.target.closest('[data-ag]'); if (!b) return;
  const [k, ...r] = b.dataset.ag.split(':'), v = r.join(':'), c = Agent.feed().find(x => x.id === v);
  if (k === 'say') { if (c && !e.target.closest('button')) Voice.respond(Agent.spoken(c)); return; }
  e.stopPropagation();
  const p = Agent.pend;
  if ((k === 'yes' || k === 'always') && p?.card === v) { Agent.pend = null; Commands.pending = null; return p.yes(k === 'always'); }
  if (k === 'no') { if (p?.card === v) { Agent.pend = null; Commands.pending = null; } return Agent.drop(v); }
  if (k === 'drop') return Agent.drop(v);
  if (k === 'retry' && c) { Agent.drop(v); return Agent.start(c.task); }
  if (k === 'signin' || k === 'browser') { closeSheet(); return AgentWeb.show(true); }
  if (k === 'go' && c) { const pl = c.place, it = (c.items || []).find(i => i.place); return pl?.lat ? Actions.run('nav.go', `${pl.lat},${pl.lon}`, quietSay) : it && Actions.run('nav.go', it.place, quietSay); }
  if (k === 'run') { closeSheet(); if (current !== 'agent') openView('agent'); return Agent.start(v); }
  if (k === 'lib') return AgentHome.lib();
  if (k === 'grp') return AgentHome.lib(v);
  if (k === 'trust') { Agent.trust(v, !Agent.trusted(v)); return AgentHome.lib(Agent.get(v)?.group); }
  if (k === 'edit') return AgentHome.edit(v);
  if (k === 'new') { closeSheet(); return typeof TaskTeach !== 'undefined' ? TaskTeach.wizard() : AgentHome.edit(); }
  if (k === 'people') return AgentHome.people();
  if (k === 'addperson') return $('#agPeople').insertAdjacentHTML('beforeend', '<div class="se-row ag-person"><input placeholder="Name" data-k="name"><input placeholder="email@work.com" data-k="email" autocapitalize="off"><input placeholder="+91 98…" data-k="phone" inputmode="tel"></div>');
  if (k === 'addstep') { const s = $('[data-agc]'); return s && s.parentElement.appendChild(Object.assign(s.cloneNode(true), { value: '' })); }
  if (k === 'cfg') return AgentHome.cfg();
  if (k === 'containers') return AgentHome.containers();
  if (k === 'ctadd') { const id = `c${Date.now().toString(36)}`; $('#ctList')?.insertAdjacentHTML('beforeend', AgentHome.ctRow({ id, name: 'New container', color: '#ff9f0a' })); return; }
  if (k === 'ctdel') { const row = b.closest('.ct-row'); if (b.dataset.sure) { row.remove(); window.DriveDeckDesktop?.browser?.forget?.(Containers.part(v)); return; } b.dataset.sure = '1'; b.textContent = 'Delete, and sign out?'; return; }
  if (k === 'ctforget') { if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Tap again: sign out of all'; return; }
    window.DriveDeckDesktop?.browser?.forget?.(Containers.part(v)).then(() => { b.textContent = 'Signed out'; toast(`Signed out of everything in ${Containers.get(v).name}`); }); return; }
  if (k === 'ctsign') { AgentHome.ctSave(); const site = Containers.sites(v)[0]; if (!site) return toast('Add a site to this container first, then Sign in');
    closeSheet(); AgentWeb.go(`https://${site}`, v).then(() => AgentWeb.show(true)); return; }
}, true);
document.addEventListener('change', e => { if (e.target.id === 'agK') $$('[data-agk]').forEach(d => { d.hidden = d.dataset.agk !== e.target.value; }); });
document.addEventListener('submit', e => {
  if (!e.target.matches('[data-agform]')) return; e.preventDefault();
  const q = $('#agAsk').value.trim(); if (!q) return openAssistant();
  $('#agAsk').value = ''; Commands.run(q, false);
});
Bus.on('view.open', d => { if (d.value === 'agent') AgentHome.show(); else { AgentHome.giveBack(d.value); const r = $('#agentRoot'); if (r?.classList.contains('ag-has-av')) { r.innerHTML = ''; r.classList.remove('ag-has-av'); } } });
