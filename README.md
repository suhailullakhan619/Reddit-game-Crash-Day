# Crash Day

**A new plane crash every day. Same jungle, same disaster, for every Redditor. Can you survive 5 days?**

Crash Day is a daily 3D survival game that runs right inside a Reddit post. Each day a seeded
crash drops every player into the same jungle with the same two emergencies (a lightning storm
that sets the engine on fire, a bird strike that leads to a fuel leak, and more). Grab an item
and brace before impact, then survive until the rescue helicopter arrives at dawn of day 6.

## How to play

- **Crash:** tap to take off. When something goes wrong, grab one item from the cabin and tap
  **Brace** at the right moment.
- **Survive:** keep your health, food, water and warmth rings up. Collect wood, stones, herbs,
  berries and water; craft a spear, a bow and arrows, campfires, a lean-to shelter, poultices
  and splints.
- **Fight or flee:** a stalking tiger, venomous vipers, boar herds, alligators in the river and,
  from day 3, a wolf pack at night. Fire keeps predators back. Dodge their telegraphed attacks.
- **It gets harder every day:** animals sense you sooner and hit harder, you get thirsty
  faster, nights get colder, storms put out fires and heavy blows can break a leg.
- **Supply drops** parachute in on days 2 and 4, and the helicopter rescue plays at dawn of day 6.

Controls: left thumb moves, right thumb looks. Keyboard: WASD, mouse, E grab, F attack,
R shoot, Space dodge, C craft.

## Built for Reddit

- **One shared crash per day:** a new post every day (scheduled), and everyone plays the same
  seed, so the comments compare the same run.
- **Daily challenge, chosen by the community:** each day has a twist (Pacifist, Firekeeper,
  Black box, Hunter and more). Players vote on tomorrow's challenge from the end card.
- **Graves of real players:** wherever a Redditor died today, a grave with their username
  stands in everyone's jungle.
- **Leaderboard, streaks, achievements and flair:** daily top survivors with avatars, play
  streaks, 8 collectible badges, and user flair like "Survivor" or "Tiger Slayer".
- **Share your run:** post your result to the comments in one tap.

## Tech

Devvit Web (Hono server, Redis, scheduler, Reddit API) with a React Three Fiber / three.js
client. Animals use skinned meshes with procedural textures; the world is seeded per day.
