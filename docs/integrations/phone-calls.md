# Phone calls

Connect call4me so bots can phone businesses for you: book an appointment or a table, ask a question, or reach customer service. call4me is a separate paid service. Its caller places the call, asks your bot when the business needs something, and returns the outcome and a transcript.

For a walkthrough with example briefs and screenshots, see [how to make phone calls from OpenTeam with call4me](/blog/ai-agent-phone-calls).

## Before you start

- **A call4me account with credits.** Sign in at [call4.me](https://call4.me) with Google or X, then load prepaid credits (from $10). Calls cost $0.25 a minute from pickup, and unanswered calls are free. See [call4me's pricing](https://call4.me/ai-call-assistant).
- **A call4me API key.** Create one on your [call4me account page](https://call4.me/account). Creating a new key revokes the old one.
- **A model with reliable tool calling.** One model serves every bot; see [model providers](../configuration/models.md).

Bots act without approval prompts, so a bot can place a call as soon as it decides to. Load a small balance and turn off call4me's monthly reload until you trust the setup.

## 1. Connect call4me

1. In **Marketplace**, open **Manage** and choose **Add custom MCP**.
2. Enter the name `call4me`, choose **Remote HTTP**, and set the MCP URL to `https://call4.me/mcp`.
3. Set **Authentication** to **Token or headers**, leave the headers empty, and choose **Add server**.
4. In **Marketplace**, open your installed plugins (the **installed** count at the top) and choose **call4me**. Under **Accounts**, open the account's settings, paste your API key into **Bearer token**, and choose **Save token**.

The account shows **Connected** when OpenTeam has loaded call4me's tools. Your server stores the key and makes the calls to call4me, so bots never see it. Connected accounts are available to every bot.

call4me also supports OAuth sign-in. OpenTeam can sign in to custom MCP servers with OAuth, but that can require an HTTPS server address; see [remote access](../configuration/remote-access.md#tailscale-https). The API key doesn't.

## 2. Add call4me's skill

call4me publishes a skill that teaches bots its calling procedure: which details to collect first, how to follow a call, and when to warn you before your phone rings.

1. Save [call4me's SKILL.md](https://call4.me/.well-known/agent-skills/call4me/SKILL.md) to your computer.
2. In **Marketplace**, choose **Manage → Private skills → Import SKILL.md** and pick the file.
3. Under **Available to Bots**, choose the bots that should make calls, then choose **Save skill**.

See [skills](../usage/skills.md) for more on private skills.

## 3. Check the connection

Ask a bot that has the skill to check your balance without calling anyone:

> Run call4me_get_balance and show me my balance, the price per minute and my call4me numbers. Don't place a call.

An empty numbers list is normal. call4me assigns your free US number on your first call; businesses see it as caller ID and can call it back.

## Make a call

Give the bot a brief with the business, the goal, what it may share, what it may agree to, and a time limit:

> Call Cedar Lane Pharmacy at (503) 555-0187 and ask whether my refill, Rx 4471093, is ready. You may give my name and the Rx number. Don't pay or change anything. Cap the call at 5 minutes.

The bot checks what call4me needs for that kind of call and asks you for anything missing. Then it places the call and follows it. If the business asks something the brief doesn't cover, the bot asks you in chat and passes your answer to the caller, so reply quickly. When the call ends, the bot reports the outcome, the cost and the transcript lines behind anything it calls confirmed.

The recording and full transcript stay in your [call4me account](https://call4.me/account). To see the tools a bot used, open **call4me** from your installed plugins and expand **Activity**.

## Schedule or repeat a call

- **Once, later:** ask the bot to schedule the call for a time when the business is open. call4me dials then, without waiting for you, so put every detail and acceptable alternative in the brief.
- **On a schedule:** create a [routine](../usage/routines.md), such as "Every Monday at 9 AM, call the pharmacy and ask whether my refill is ready." Turn the routine off once you have your answer, because every connected call costs money.

## Join or listen in

call4me can ring the phone number saved in your call4me profile. Ask the bot to ring you when a person answers, to let you listen in, or to connect you during the call. Press 1 to join, and press * or hang up to hand the call back to the caller.

## Rules and limits

- call4me calls businesses and services you want to reach. It won't make telemarketing, survey or collection calls, or call emergency or premium-rate numbers. See [call4me's rules](https://call4.me/rules).
- The caller doesn't open by saying it's an AI, but it tells the truth if someone sincerely asks, and it never claims to be you.
- call4me covers the US, Canada, Europe, the UAE and Japan, and other countries where you have a call4me number.
- A time limit caps the conversation, not hold time. A call on hold keeps waiting while your balance covers it.

## Fix common problems

| Problem | What to do |
| --- | --- |
| The account shows "sign in to call4me" | No valid key reached call4me. Check that **Authentication** is **Token or headers**, then save the key again under **Bearer token**. |
| "call4me key not accepted" | The key is wrong, or a newer key replaced it. Create a key on your call4me account page and save it again. |
| The bot can't find call4me's tools | Open **call4me** from your installed plugins in **Marketplace**. If the account isn't **Connected**, choose **Connect**, or **Restart** in the account's settings. |
| call4me answers "Not calling yet" | The brief is missing something that kind of call needs. Nothing was dialed. Answer the bot's question and it tries again. |
| A call sits on hold | Ask the bot to ring you when a person picks up, or to hang up after a set wait. |
