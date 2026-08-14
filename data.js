/* ============================================================
   IRONPATH — progression data
   Source: BWF Progressions v2 chart (Overcoming Gravity 2nd Ed /
   Reddit Bodyweight Fitness Recommended Routine)
   Bands: beg → int → adv → elite
   scheme.type: 'reps' | 'reps-side' | 'hold' | 'neg' (slow negatives)
   Every level has a hardcoded TEST-OUT gate — pass it to unlock the next.
   ============================================================ */

const BANDS = {
  beg:   { label: 'BEGINNER',     color: 'var(--band-beg)' },
  int:   { label: 'INTERMEDIATE', color: 'var(--band-int)' },
  adv:   { label: 'ADVANCED',     color: 'var(--band-adv)' },
  elite: { label: 'ELITE',        color: 'var(--band-elite)' },
};

/* A level:
   { name, band, scheme:{type,sets,start,cap,unit}, cue,
     test:{ label, checks:[...] } }
   'start' → first-session target per set. 'cap' → test-ready threshold.  */

const CHAINS = [
  {
    id: 'row', title: 'Horizontal Pull', short: 'ROW', icon: 'row',
    levels: [
      { name: 'Vertical Row', band: 'beg',
        scheme: { type: 'reps', sets: 3, start: 8, cap: 12 },
        cue: 'Stand, lean back holding a door frame or rings. Pull chest to hands, squeeze shoulder blades.',
        test: { label: '3×12 clean vertical rows', checks: [
          'Completed 3 sets of 12 reps', 'Full range — chest to hands each rep',
          'Shoulder blades pinched at top, no shrugging', '≤90s rest between sets' ] } },
      { name: 'Incline Row', band: 'beg',
        scheme: { type: 'reps', sets: 3, start: 6, cap: 10 },
        cue: 'Body at ~45°, straight line ear-to-ankle. Pull until chest touches the bar/rings.',
        test: { label: '3×10 incline rows', checks: [
          'Completed 3 sets of 10 reps', 'Body rigid — no hip sag or kip',
          'Chest touches bar every rep', '≤90s rest between sets' ] } },
      { name: 'Horizontal Row', band: 'beg',
        scheme: { type: 'reps', sets: 3, start: 5, cap: 8 },
        cue: 'Body horizontal under bar/rings, heels on floor. Chest to bar, 1s pause at top.',
        test: { label: '3×8 horizontal rows  ·  ESCAPES BEGINNER', checks: [
          'Completed 3 sets of 8 reps', 'Body stays in one straight line',
          'Chest to bar with 1s pause', '≤90s rest between sets' ] } },
      { name: 'Wide Row', band: 'int',
        scheme: { type: 'reps', sets: 3, start: 5, cap: 8 },
        cue: 'Grip 1.5× shoulder width, elbows flare ~60°. Slower tempo, total control.',
        test: { label: '3×8 wide rows', checks: [
          'Completed 3 sets of 8 reps', 'Controlled 2s negative every rep',
          'No shoulder rolling forward at top' ] } },
      { name: 'Archer Row', band: 'int',
        scheme: { type: 'reps-side', sets: 3, start: 4, cap: 6 },
        cue: 'Pull to one hand while the other arm stays straight and assists. Alternate sides.',
        test: { label: '3×6 per side archer rows', checks: [
          'Completed 3 sets of 6 reps each side', 'Assist arm stays fully straight',
          'Torso square — no twisting' ] } },
      { name: 'Tuck Front Lever Row', band: 'adv',
        scheme: { type: 'reps', sets: 3, start: 3, cap: 6 },
        cue: 'Hang in tuck front lever (hips at bar height), row body up to bar.',
        test: { label: '3×6 tuck FL rows  ·  MASTERY GATE', checks: [
          'Completed 3 sets of 6 reps', 'Hips stay level with shoulders throughout',
          'Full pull — bar to waist' ] } },
      { name: 'Adv Tuck FL Row', band: 'adv',
        scheme: { type: 'reps', sets: 3, start: 3, cap: 5 },
        cue: 'Open the tuck to ~90° back angle. Body stays parallel to floor during row.',
        test: { label: '3×5 advanced tuck FL rows', checks: [
          'Completed 3 sets of 5 reps', 'Back flat (not balled up)', 'No hip drop mid-row' ] } },
      { name: 'Straddle FL Row', band: 'elite',
        scheme: { type: 'reps', sets: 3, start: 2, cap: 4 },
        cue: 'Legs straight and wide. This is elite territory — quality over everything.',
        test: { label: '3×4 straddle FL rows', checks: [
          'Completed 3 sets of 4 reps', 'Body parallel, legs locked straight' ] } },
      { name: 'Front Lever Row', band: 'elite',
        scheme: { type: 'reps', sets: 3, start: 1, cap: 3 },
        cue: 'Full front lever, row to waist. The summit of horizontal pulling.',
        test: { label: '3×3 full front lever rows', checks: [
          'Completed 3 sets of 3 reps', 'Full body line — zero pike or sag' ] } },
    ],
  },

  {
    id: 'pullup', title: 'Vertical Pull', short: 'PULL-UP', icon: 'pullup',
    levels: [
      { name: 'Scapular Shrug', band: 'beg',
        scheme: { type: 'reps', sets: 3, start: 8, cap: 12 },
        cue: 'Dead hang, arms straight. Pull shoulder blades down — body rises a few inches.',
        test: { label: '3×12 scapular shrugs', checks: [
          'Completed 3 sets of 12 reps', 'Arms stayed completely straight',
          '2s hold at top of each shrug' ] } },
      { name: 'Arch Hang', band: 'beg',
        scheme: { type: 'reps', sets: 3, start: 5, cap: 10 },
        cue: 'Pull shoulder blades back and down, chest up, squeeze — hold 3s each rep.',
        test: { label: '3×10 arch hangs w/ 3s holds', checks: [
          'Completed 3 sets of 10 reps', 'Held 3 seconds per rep',
          'Chest driven up, shoulders back' ] } },
      { name: 'Pull Up Negative', band: 'beg',
        scheme: { type: 'neg', sets: 3, start: 3, cap: 5 },
        cue: 'Jump to top of pull-up, lower under total control for 5+ seconds.',
        test: { label: '3×5 five-second negatives  ·  ESCAPES BEGINNER', checks: [
          'Completed 3 sets of 5 negatives', 'Every negative ≥5 seconds',
          'Controlled through the bottom — no dropping off' ] } },
      { name: 'Pull Up', band: 'int',
        scheme: { type: 'reps', sets: 3, start: 3, cap: 8 },
        cue: 'Dead hang to chin over bar. No kipping. This is THE milestone.',
        test: { label: '3×8 dead-hang pull ups  ·  MILESTONE', checks: [
          'Completed 3 sets of 8 reps', 'Full dead hang at bottom of every rep',
          'Chin clears bar without kipping', '≤90s rest between sets' ] } },
      { name: 'L-Pull Up', band: 'int',
        scheme: { type: 'reps', sets: 3, start: 3, cap: 6 },
        cue: 'Legs held straight out at 90° for the entire set. Brutal core + lat work.',
        test: { label: '3×6 L-pull ups', checks: [
          'Completed 3 sets of 6 reps', 'Legs horizontal and straight whole set' ] } },
      { name: 'Chest to Bar PU', band: 'int',
        scheme: { type: 'reps', sets: 3, start: 3, cap: 6 },
        cue: 'Pull explosively until chest touches the bar at sternum height.',
        test: { label: '3×6 chest-to-bar pull ups', checks: [
          'Completed 3 sets of 6 reps', 'Chest physically touches bar each rep' ] } },
      { name: 'Archer Pull Up', band: 'adv',
        scheme: { type: 'reps-side', sets: 3, start: 3, cap: 5 },
        cue: 'Pull to one hand, other arm straightens across the bar. Alternate.',
        test: { label: '3×5 per side archer pull ups  ·  MASTERY GATE', checks: [
          'Completed 3 sets of 5 each side', 'Straight arm fully locked',
          'Chin over hand on working side' ] } },
      { name: 'OA Pull Up Negative', band: 'adv',
        scheme: { type: 'neg', sets: 3, start: 2, cap: 4 },
        cue: 'One-arm negatives, 7+ seconds down. Grease the groove carefully — tendons first.',
        test: { label: '3×4 one-arm negatives ≥7s', checks: [
          'Completed 3 sets of 4 per arm', 'Every negative ≥7 seconds',
          'Zero elbow pain during or after' ] } },
      { name: 'Muscle Up', band: 'elite',
        scheme: { type: 'reps', sets: 3, start: 1, cap: 5 },
        cue: 'Pull-up flows over the bar into a dip. Strict — no chicken-winging.',
        test: { label: '3×5 strict muscle ups', checks: [
          'Completed 3 sets of 5 reps', 'No kip, both arms transition together' ] } },
      { name: 'One Arm Pull Up', band: 'elite',
        scheme: { type: 'reps', sets: 3, start: 1, cap: 3 },
        cue: 'The crown jewel of vertical pulling.',
        test: { label: '3×3 one-arm pull ups', checks: [
          'Completed 3 sets of 3 per arm', 'Dead hang start, chin over hand' ] } },
    ],
  },

  {
    id: 'pushup', title: 'Horizontal Push', short: 'PUSH-UP', icon: 'pushup',
    levels: [
      { name: 'Incline Push Up', band: 'beg',
        scheme: { type: 'reps', sets: 3, start: 8, cap: 12 },
        cue: 'Hands on bench/table. Body rigid, chest to edge, full lockout.',
        test: { label: '3×12 incline push ups', checks: [
          'Completed 3 sets of 12 reps', 'Chest touches surface each rep',
          'Hips never sag' ] } },
      { name: 'Push Up', band: 'beg',
        scheme: { type: 'reps', sets: 3, start: 5, cap: 10 },
        cue: 'Full floor push-up. Elbows ~45°, chest brushes floor, hard lockout.',
        test: { label: '3×10 full push ups  ·  ESCAPES BEGINNER', checks: [
          'Completed 3 sets of 10 reps', 'Chest to within a fist of the floor',
          'Body one straight line throughout', '≤90s rest between sets' ] } },
      { name: 'Diamond Push Up', band: 'int',
        scheme: { type: 'reps', sets: 3, start: 5, cap: 10 },
        cue: 'Thumbs and index fingers form a diamond under sternum. Triceps on fire.',
        test: { label: '3×10 diamond push ups', checks: [
          'Completed 3 sets of 10 reps', 'Chest touches hands each rep' ] } },
      { name: 'Pseudo Planche PU', band: 'int',
        scheme: { type: 'reps', sets: 3, start: 4, cap: 8 },
        cue: 'Hands at waist, fingers back, lean hard forward. Shoulders past hands.',
        test: { label: '3×8 pseudo planche push ups', checks: [
          'Completed 3 sets of 8 reps', 'Shoulders stay in front of hands whole rep',
          'Maximum forward lean maintained' ] } },
      { name: 'Archer Push Up', band: 'adv',
        scheme: { type: 'reps-side', sets: 3, start: 4, cap: 6 },
        cue: 'One arm bends, the other stays straight out wide. Alternate sides.',
        test: { label: '3×6 per side archer push ups  ·  MASTERY GATE', checks: [
          'Completed 3 sets of 6 each side', 'Straight arm locked the whole rep',
          'Chest to floor over working hand' ] } },
      { name: 'RTO Push Up', band: 'adv',
        scheme: { type: 'reps', sets: 3, start: 4, cap: 8 },
        cue: 'Rings turned out 45°+ at lockout. If no rings: one-arm incline push ups.',
        test: { label: '3×8 RTO (or OA incline) push ups', checks: [
          'Completed 3 sets of 8 reps', 'Rings turned out at every lockout',
          'No shaking collapse — smooth control' ] } },
      { name: 'One Arm Push Up', band: 'elite',
        scheme: { type: 'reps-side', sets: 3, start: 2, cap: 5 },
        cue: 'Feet ~shoulder width, working hand under sternum, zero torso twist.',
        test: { label: '3×5 per side one-arm push ups', checks: [
          'Completed 3 sets of 5 each side', 'Shoulders stay square to floor',
          'Chest to fist height' ] } },
      { name: 'Tuck Planche PU', band: 'elite',
        scheme: { type: 'reps', sets: 3, start: 1, cap: 3 },
        cue: 'Push ups in tuck planche — feet never touch. Straight-arm strength endgame.',
        test: { label: '3×3 tuck planche push ups', checks: [
          'Completed 3 sets of 3 reps', 'Feet off floor the entire set' ] } },
    ],
  },

  {
    id: 'dip', title: 'Vertical Push', short: 'DIP', icon: 'dip',
    levels: [
      { name: 'PB Support Hold', band: 'beg',
        scheme: { type: 'hold', sets: 3, start: 15, cap: 60, unit: 's' },
        cue: 'Lock out on parallel bars (or chair backs). Shoulders down, elbows locked.',
        test: { label: '60s unbroken support hold', checks: [
          'Held 60 seconds without breaking', 'Elbows locked, shoulders depressed',
          'No shaking collapse at the end' ] } },
      { name: 'Dip Negative', band: 'beg',
        scheme: { type: 'neg', sets: 3, start: 3, cap: 5 },
        cue: 'Start at lockout, lower 5s until shoulders below elbows, step off, reset.',
        test: { label: '3×5 five-second dip negatives  ·  ESCAPES BEGINNER', checks: [
          'Completed 3 sets of 5 negatives', 'Every negative ≥5 seconds',
          'Full depth — shoulder below elbow' ] } },
      { name: 'Dip', band: 'int',
        scheme: { type: 'reps', sets: 3, start: 3, cap: 8 },
        cue: 'Full dips: below parallel, drive to lockout. Slight forward lean.',
        test: { label: '3×8 full dips  ·  MILESTONE', checks: [
          'Completed 3 sets of 8 reps', 'Shoulder below elbow at bottom every rep',
          'Full lockout at top', '≤90s rest between sets' ] } },
      { name: 'L-Dip', band: 'int',
        scheme: { type: 'reps', sets: 3, start: 3, cap: 6 },
        cue: 'Dips with legs held in L-sit. Core and shoulders together.',
        test: { label: '3×6 L-dips', checks: [
          'Completed 3 sets of 6 reps', 'Legs horizontal the entire set' ] } },
      { name: 'Bulgarian Dip', band: 'int',
        scheme: { type: 'reps', sets: 3, start: 4, cap: 8 },
        cue: 'Elbows flared out wide, chest drops between hands. Ring-dip preparation.',
        test: { label: '3×8 bulgarian dips', checks: [
          'Completed 3 sets of 8 reps', 'Elbows track out, full depth' ] } },
      { name: 'Ring Dip Negative', band: 'adv',
        scheme: { type: 'neg', sets: 3, start: 3, cap: 5 },
        cue: 'On rings: lockout, lower 5s fighting the wobble. No rings? weighted dips +10%BW.',
        test: { label: '3×5 ring dip negatives', checks: [
          'Completed 3 sets of 5 negatives', 'Every negative ≥5s and stable' ] } },
      { name: 'Ring Dip', band: 'adv',
        scheme: { type: 'reps', sets: 3, start: 3, cap: 8 },
        cue: 'Full dips on rings, rings close to body.',
        test: { label: '3×8 ring dips  ·  MASTERY GATE', checks: [
          'Completed 3 sets of 8 reps', 'Full depth, no ring flare at bottom' ] } },
      { name: 'RTO Dip', band: 'elite',
        scheme: { type: 'reps', sets: 3, start: 2, cap: 5 },
        cue: 'Rings turned out at lockout on every rep. Elite shoulder integrity.',
        test: { label: '3×5 RTO dips', checks: [
          'Completed 3 sets of 5 reps', 'Rings turned out 45°+ at each lockout' ] } },
      { name: 'Ring L-Dip', band: 'elite',
        scheme: { type: 'reps', sets: 3, start: 2, cap: 5 },
        cue: 'L-sit held through full ring dips. The vertical-push summit.',
        test: { label: '3×5 ring L-dips', checks: [
          'Completed 3 sets of 5 reps', 'L-sit unbroken the entire set' ] } },
    ],
  },

  {
    id: 'hs', title: 'Handstand Line', short: 'HANDSTAND', icon: 'hs',
    levels: [
      { name: 'Wall Plank', band: 'beg',
        scheme: { type: 'hold', sets: 3, start: 20, cap: 60, unit: 's' },
        cue: 'Feet on wall, walk hands back until body is at ~45-60°. Push tall through shoulders.',
        test: { label: '3×60s wall plank', checks: [
          'Held 3 sets of 60 seconds', 'Arms locked, shoulders elevated',
          'No banana back' ] } },
      { name: 'Pike Push Up', band: 'beg',
        scheme: { type: 'reps', sets: 3, start: 5, cap: 10 },
        cue: 'Hips high in a pike, head travels to floor in front of hands, press back up.',
        test: { label: '3×10 pike push ups  ·  ESCAPES BEGINNER', checks: [
          'Completed 3 sets of 10 reps', 'Head lightly touches floor each rep',
          'Hips stay high — vertical pressing line' ] } },
      { name: 'Decline Pike PU', band: 'int',
        scheme: { type: 'reps', sets: 3, start: 5, cap: 8 },
        cue: 'Feet elevated on box/chair, torso near-vertical. Halfway to a handstand push up.',
        test: { label: '3×8 decline pike push ups', checks: [
          'Completed 3 sets of 8 reps', 'Torso near-vertical, head to floor' ] } },
      { name: 'Wall Handstand', band: 'int',
        scheme: { type: 'hold', sets: 3, start: 20, cap: 60, unit: 's' },
        cue: 'Chest-to-wall handstand. Stack: hands-shoulders-hips-toes. Breathe.',
        test: { label: '60s unbroken wall handstand', checks: [
          'Held 60 seconds chest-to-wall', 'Body fully stacked and open shoulders',
          'Controlled exit — no crashing' ] } },
      { name: 'Freestanding HS', band: 'adv',
        scheme: { type: 'hold', sets: 5, start: 5, cap: 15, unit: 's' },
        cue: 'Kick up away from wall. Fingertips fight the fall. Log your longest holds.',
        test: { label: '15s freestanding handstand  ·  MASTERY GATE', checks: [
          'Held 15 seconds freestanding', 'Two clean kick-up attempts in a row',
          'Controlled step-down exit' ] } },
      { name: 'Wall HSPU Negative', band: 'adv',
        scheme: { type: 'neg', sets: 3, start: 3, cap: 5 },
        cue: 'Wall handstand, lower 5s to headtouch, kick down, reset.',
        test: { label: '3×5 wall HSPU negatives', checks: [
          'Completed 3 sets of 5 negatives', 'Every negative ≥5 seconds' ] } },
      { name: 'Wall HSPU', band: 'adv',
        scheme: { type: 'reps', sets: 3, start: 2, cap: 5 },
        cue: 'Full handstand push ups against the wall. Head to floor, press to lockout.',
        test: { label: '3×5 wall handstand push ups', checks: [
          'Completed 3 sets of 5 reps', 'Full range — head touches, full lockout' ] } },
      { name: 'Freestanding HSPU', band: 'elite',
        scheme: { type: 'reps', sets: 3, start: 1, cap: 3 },
        cue: 'No wall. Balance + press. One of the great bodyweight feats.',
        test: { label: '3×3 freestanding HSPU', checks: [
          'Completed 3 sets of 3 reps', 'No wall touches' ] } },
    ],
  },

  {
    id: 'squat', title: 'Legs — Knee', short: 'SQUAT', icon: 'squat',
    levels: [
      { name: 'Assisted Squat', band: 'beg',
        scheme: { type: 'reps', sets: 3, start: 8, cap: 15 },
        cue: 'Hold a pole/doorframe, sit back and down as deep as comfortable.',
        test: { label: '3×15 assisted squats', checks: [
          'Completed 3 sets of 15 reps', 'Below parallel each rep', 'Heels stay down' ] } },
      { name: 'Parallel Squat', band: 'beg',
        scheme: { type: 'reps', sets: 3, start: 8, cap: 15 },
        cue: 'Unassisted to parallel. Knees track over toes, chest proud.',
        test: { label: '3×15 parallel squats', checks: [
          'Completed 3 sets of 15 reps', 'Thighs parallel each rep', 'No knee cave' ] } },
      { name: 'Full Squat', band: 'beg',
        scheme: { type: 'reps', sets: 3, start: 8, cap: 15 },
        cue: 'Deep squat, hips below knees. Own the bottom position.',
        test: { label: '3×15 full deep squats  ·  ESCAPES BEGINNER', checks: [
          'Completed 3 sets of 15 reps', 'Hips below knees every rep',
          'Heels down, torso upright', '2s pause at bottom of last rep each set' ] } },
      { name: 'Split Squat', band: 'int',
        scheme: { type: 'reps-side', sets: 3, start: 6, cap: 10 },
        cue: 'Long stance, back knee kisses the floor. Vertical torso.',
        test: { label: '3×10 per leg split squats', checks: [
          'Completed 3 sets of 10 each leg', 'Back knee touches lightly each rep' ] } },
      { name: 'Bulgarian Split Squat', band: 'int',
        scheme: { type: 'reps-side', sets: 3, start: 5, cap: 10 },
        cue: 'Rear foot elevated on bench. Deep, controlled, no wobble.',
        test: { label: '3×10 per leg bulgarians', checks: [
          'Completed 3 sets of 10 each leg', 'Full depth, front heel down' ] } },
      { name: 'Beg Shrimp Squat', band: 'int',
        scheme: { type: 'reps-side', sets: 3, start: 4, cap: 8 },
        cue: 'Stand on one leg, bend the other behind you, squat until back knee touches.',
        test: { label: '3×8 per leg beginner shrimps', checks: [
          'Completed 3 sets of 8 each leg', 'Back knee touches with control' ] } },
      { name: 'Assisted Pistol Squat', band: 'adv',
        scheme: { type: 'reps-side', sets: 3, start: 4, cap: 8 },
        cue: 'One leg out front, light fingertip assist. Sit all the way down.',
        test: { label: '3×8 per leg assisted pistols', checks: [
          'Completed 3 sets of 8 each leg', 'Full depth, minimal assist' ] } },
      { name: 'Pistol Squat', band: 'adv',
        scheme: { type: 'reps-side', sets: 3, start: 3, cap: 8 },
        cue: 'Free one-leg squat, other leg straight out. Heel stays planted.',
        test: { label: '3×8 per leg pistol squats  ·  MASTERY GATE', checks: [
          'Completed 3 sets of 8 each leg', 'No hands, heel down, full depth' ] } },
      { name: 'Shrimp Squat', band: 'elite',
        scheme: { type: 'reps-side', sets: 3, start: 3, cap: 6 },
        cue: 'Hold rear foot with both hands behind you while squatting. Balance + mobility + strength.',
        test: { label: '3×6 per leg full shrimps', checks: [
          'Completed 3 sets of 6 each leg', 'Both hands on rear foot throughout' ] } },
      { name: 'Elevated Shrimp Squat', band: 'elite',
        scheme: { type: 'reps-side', sets: 3, start: 2, cap: 5 },
        cue: 'Front foot on an elevation for extra depth. Leg-strength summit.',
        test: { label: '3×5 per leg elevated shrimps', checks: [
          'Completed 3 sets of 5 each leg', 'Knee travels below platform level' ] } },
    ],
  },

  {
    id: 'hinge', title: 'Legs — Hip', short: 'HINGE', icon: 'hinge',
    levels: [
      { name: 'Reverse Hyperextension', band: 'beg',
        scheme: { type: 'reps', sets: 3, start: 10, cap: 15 },
        cue: 'Hips on bench/bed edge, legs hang. Raise legs to body line, squeeze glutes.',
        test: { label: '3×15 reverse hypers', checks: [
          'Completed 3 sets of 15 reps', '2s glute squeeze at top' ] } },
      { name: 'One Leg Deadlift', band: 'beg',
        scheme: { type: 'reps-side', sets: 3, start: 6, cap: 12 },
        cue: 'Hinge on one leg, back flat, rear leg to horizontal. Feel the hamstring load.',
        test: { label: '3×12 per leg OL deadlifts  ·  ESCAPES BEGINNER', checks: [
          'Completed 3 sets of 12 each leg', 'Flat back, square hips',
          'Rear leg reaches horizontal' ] } },
      { name: '90° Hip Nordic Curl', band: 'int',
        scheme: { type: 'reps', sets: 3, start: 4, cap: 8 },
        cue: 'Kneel, ankles anchored, hips bent 90°. Lower torso with hamstrings only.',
        test: { label: '3×8 hip-hinged nordics', checks: [
          'Completed 3 sets of 8 reps', 'Hamstrings control the whole descent' ] } },
      { name: '45° Hip Nordic Curl', band: 'int',
        scheme: { type: 'reps', sets: 3, start: 3, cap: 6 },
        cue: 'Straighten the hips to ~45°. Longer lever, way harder.',
        test: { label: '3×6 45° nordics', checks: [
          'Completed 3 sets of 6 reps', 'Hip angle held — no folding to escape' ] } },
      { name: 'Nordic Curl Negative', band: 'adv',
        scheme: { type: 'neg', sets: 3, start: 3, cap: 5 },
        cue: 'Body straight, lower as slow as physically possible. Push back up with hands.',
        test: { label: '3×5 slow nordic negatives  ·  MASTERY GATE', checks: [
          'Completed 3 sets of 5 negatives', 'Every negative ≥6 seconds',
          'Body straight — no hip break until failure point' ] } },
      { name: 'Nordic Curl', band: 'elite',
        scheme: { type: 'reps', sets: 3, start: 1, cap: 5 },
        cue: 'Full nordic: lower and curl back up with pure hamstring. Elite posterior chain.',
        test: { label: '3×5 full nordic curls', checks: [
          'Completed 3 sets of 5 reps', 'No hand push, minimal hip break' ] } },
    ],
  },

  {
    id: 'lsit', title: 'Compression', short: 'L-SIT', icon: 'lsit',
    levels: [
      { name: 'Foot Supported L-Sit', band: 'beg',
        scheme: { type: 'hold', sets: 3, start: 15, cap: 30, unit: 's' },
        cue: 'On parallettes/floor, heels lightly on floor, hips lifted, chest tall.',
        test: { label: '3×30s foot-supported L-sit', checks: [
          'Held 3 sets of 30 seconds', 'Shoulders depressed, arms locked' ] } },
      { name: 'One Leg L-Sit', band: 'beg',
        scheme: { type: 'hold', sets: 3, start: 10, cap: 20, unit: 's' },
        cue: 'One leg extended horizontal, other foot lightly supported. Swap legs per set.',
        test: { label: '3×20s one-leg L-sit  ·  ESCAPES BEGINNER', checks: [
          'Held 3 sets of 20 seconds per leg', 'Extended leg straight and horizontal' ] } },
      { name: 'Tuck L-Sit', band: 'int',
        scheme: { type: 'hold', sets: 3, start: 10, cap: 20, unit: 's' },
        cue: 'Both feet off floor, knees tucked to chest. All bodyweight on hands.',
        test: { label: '3×20s tuck L-sit', checks: [
          'Held 3 sets of 20 seconds', 'Feet never touch down mid-set' ] } },
      { name: 'One Leg Bent L-Sit', band: 'int',
        scheme: { type: 'hold', sets: 3, start: 10, cap: 15, unit: 's' },
        cue: 'One leg straight out, one tucked. Alternate per set.',
        test: { label: '3×15s per side', checks: [
          'Held 3 sets of 15 seconds each side', 'Straight leg locked at horizontal' ] } },
      { name: 'L-Sit', band: 'adv',
        scheme: { type: 'hold', sets: 3, start: 5, cap: 20, unit: 's' },
        cue: 'Both legs straight and horizontal. The classic. Push the floor away.',
        test: { label: '3×20s full L-sit  ·  MASTERY GATE', checks: [
          'Held 3 sets of 20 seconds', 'Legs locked straight at horizontal',
          'Toes pointed, chest open' ] } },
      { name: 'Straddle L-Sit', band: 'adv',
        scheme: { type: 'hold', sets: 3, start: 5, cap: 15, unit: 's' },
        cue: 'Legs wide and lifted higher than hip line. Compression strength builder.',
        test: { label: '3×15s straddle L-sit', checks: [
          'Held 3 sets of 15 seconds', 'Legs above hip line' ] } },
      { name: '45° V-Sit', band: 'elite',
        scheme: { type: 'hold', sets: 3, start: 3, cap: 10, unit: 's' },
        cue: 'Legs lifted to 45° above horizontal. Entering elite compression.',
        test: { label: '3×10s 45° V-sit', checks: [
          'Held 3 sets of 10 seconds', 'Legs at 45°, arms locked' ] } },
      { name: 'V-Sit → Manna', band: 'elite',
        scheme: { type: 'hold', sets: 3, start: 3, cap: 10, unit: 's' },
        cue: 'Keep raising the legs past vertical toward manna. A multi-year pursuit.',
        test: { label: '3×10s high V-sit', checks: [
          'Held 3 sets of 10 seconds beyond 75°' ] } },
    ],
  },

  {
    id: 'hang', title: 'Hanging Core', short: 'LEG RAISE', icon: 'hang',
    levels: [
      { name: 'Hanging Knees to Chest', band: 'beg',
        scheme: { type: 'reps', sets: 3, start: 6, cap: 12 },
        cue: 'Dead hang, pull knees to chest without swinging. Slow down, no momentum.',
        test: { label: '3×12 knees to chest', checks: [
          'Completed 3 sets of 12 reps', 'Zero swing between reps' ] } },
      { name: 'Hanging Bent Leg Raise', band: 'beg',
        scheme: { type: 'reps', sets: 3, start: 6, cap: 10 },
        cue: 'Knees bent 90°, raise thighs past horizontal, lower with control.',
        test: { label: '3×10 bent leg raises  ·  ESCAPES BEGINNER', checks: [
          'Completed 3 sets of 10 reps', 'Thighs past horizontal each rep',
          'Controlled negative — no drop' ] } },
      { name: 'Hanging Leg Raise', band: 'int',
        scheme: { type: 'reps', sets: 3, start: 5, cap: 10 },
        cue: 'Legs dead straight, raise to horizontal or above. The core standard.',
        test: { label: '3×10 straight leg raises', checks: [
          'Completed 3 sets of 10 reps', 'Legs straight, to horizontal+' ] } },
      { name: 'Toes to Bar', band: 'adv',
        scheme: { type: 'reps', sets: 3, start: 3, cap: 8 },
        cue: 'Straight legs all the way until toes touch the bar. Full compression.',
        test: { label: '3×8 toes to bar  ·  MASTERY GATE', checks: [
          'Completed 3 sets of 8 reps', 'Toes physically touch bar',
          'Legs straight, no kipping' ] } },
      { name: 'Ankle Weight T2B', band: 'elite',
        scheme: { type: 'reps', sets: 3, start: 3, cap: 6 },
        cue: 'Add ankle weights. Elite-grade compression strength.',
        test: { label: '3×6 weighted toes to bar', checks: [
          'Completed 3 sets of 6 reps with weight' ] } },
    ],
  },

  {
    id: 'antiext', title: 'Anti-Extension', short: 'PLANK→WHEEL', icon: 'plank',
    levels: [
      { name: 'Plank', band: 'beg',
        scheme: { type: 'hold', sets: 3, start: 25, cap: 60, unit: 's' },
        cue: 'Forearm plank. Glutes squeezed, ribs down, one straight line.',
        test: { label: '3×60s hard-style plank  ·  ESCAPES BEGINNER', checks: [
          'Held 3 sets of 60 seconds', 'Glutes + abs braced whole time — no sag' ] } },
      { name: 'One Arm Plank', band: 'int',
        scheme: { type: 'hold', sets: 3, start: 15, cap: 30, unit: 's' },
        cue: 'One arm behind your back, hips stay square. Swap arms per set.',
        test: { label: '3×30s per arm', checks: [
          'Held 3 sets of 30 seconds per arm', 'Hips level — no rotation' ] } },
      { name: 'Knees Ab Wheel', band: 'int',
        scheme: { type: 'reps', sets: 3, start: 5, cap: 10 },
        cue: 'Roll out from knees as far as you can hold a hollow body. No banana back.',
        test: { label: '3×10 knee rollouts', checks: [
          'Completed 3 sets of 10 reps', 'Lower back never arches' ] } },
      { name: 'Ab Wheel Negative', band: 'adv',
        scheme: { type: 'neg', sets: 3, start: 3, cap: 5 },
        cue: 'From standing, roll out slowly to flat — 5s down — knees down to reset.',
        test: { label: '3×5 standing negatives', checks: [
          'Completed 3 sets of 5 negatives', 'Every negative ≥5 seconds',
          'Hollow body held to the floor' ] } },
      { name: 'Standing Ab Wheel', band: 'adv',
        scheme: { type: 'reps', sets: 3, start: 2, cap: 5 },
        cue: 'Full standing rollout and return. Iron core.',
        test: { label: '3×5 standing rollouts  ·  MASTERY GATE', checks: [
          'Completed 3 sets of 5 reps', 'Full extension — nose near floor' ] } },
      { name: 'Dragon Flag', band: 'elite',
        scheme: { type: 'reps', sets: 3, start: 2, cap: 5 },
        cue: 'Bruce Lee’s move. Body straight as a board, lower from vertical to hover.',
        test: { label: '3×5 dragon flags', checks: [
          'Completed 3 sets of 5 reps', 'Body rigid — only shoulders touch bench' ] } },
    ],
  },
];

/* ---------- 3-day full-body program (Mon/Wed/Fri) ----------
   Same movement chains every session (frequency drives mastery);
   the DAY TYPE changes the stimulus = daily undulating periodization. */

const DAYS = {
  A: { key: 'A', name: 'HEAVY', tagline: 'Top-end strength · full targets · earn your reps',
       desc: 'Hit the full target on every set. If you complete all sets at target, the target rises next session — that is the overload engine.',
       setMod: 0, restPair: 90, restCore: 60 },
  B: { key: 'B', name: 'TECHNIQUE', tagline: 'Volume & control · 1 rep in reserve · perfect form',
       desc: 'Targets drop ~20%. Every rep slow and perfect: 2s negatives, pauses, full range. This session builds the tendons that day A spends.',
       setMod: -0.2, restPair: 75, restCore: 45 },
  C: { key: 'C', name: 'TEST', tagline: 'Strength + final AMRAP set · prove the level',
       desc: 'Normal targets, but the last set of each exercise is AMRAP (as many clean reps as possible). Hit the test-out threshold here and the gate unlocks.',
       setMod: 0, restPair: 90, restCore: 60 },
};

/* Session structure: which chains appear, in what blocks. */
const SESSION_BLOCKS = [
  { id: 'skill', title: 'Skill Block', note: 'Fresh nervous system first. 8–10 min, never to failure.',
    chains: ['hs', 'lsit'] },
  { id: 'pair1', title: 'Pair 1', note: 'Superset: one set pull, rest, one set legs, rest, repeat.',
    chains: ['pullup', 'squat'] },
  { id: 'pair2', title: 'Pair 2', note: 'Superset: vertical push with hip hinge.',
    chains: ['dip', 'hinge'] },
  { id: 'pair3', title: 'Pair 3', note: 'Superset: horizontal pull with horizontal push.',
    chains: ['row', 'pushup'] },
  { id: 'core', title: 'Core Finisher', note: 'Shorter rests. Quality reps only.',
    chains: ['hang', 'antiext'] },
];

const WARMUP = [
  '2–3 min easy cardio (jumping jacks / skipping / brisk stairs)',
  'Wrist circles + wrist rocks — 30s each direction',
  'Shoulder dislocates with band or towel × 10',
  'Scapular push ups × 8 + scapular pulls × 8',
  'Deep squat hold 30s + hip circles',
  'Two easy warm-up sets of your first pair at 50% effort',
];

/* ---------- Roadmap phases (hardcoded gates) ----------
   req: { chain, level } → gate is met when chain progress passes that level name. */

const PHASES = [
  {
    id: 'p1', num: 'PHASE 01', name: 'ESCAPE BEGINNER', window: 'Day 1–30',
    story: 'One goal: clear the beginner band in every chain inside 30 days. Train Mon/Wed/Fri, zero missed sessions. Rows, squats, planks and hinges will fall fast; pull ups and dips are the boss fights — negatives are how you beat them.',
    reqs: [
      { chain: 'row',    level: 'Horizontal Row' },
      { chain: 'pullup', level: 'Pull Up Negative' },
      { chain: 'pushup', level: 'Push Up' },
      { chain: 'dip',    level: 'Dip Negative' },
      { chain: 'hs',     level: 'Pike Push Up' },
      { chain: 'squat',  level: 'Full Squat' },
      { chain: 'hinge',  level: 'One Leg Deadlift' },
      { chain: 'lsit',   level: 'One Leg L-Sit' },
      { chain: 'hang',   level: 'Hanging Bent Leg Raise' },
      { chain: 'antiext', level: 'Plank' },
    ],
  },
  {
    id: 'p2', num: 'PHASE 02', name: 'BUILD', window: 'Month 2–3',
    story: 'Own the fundamental milestones: your first strict pull ups and dips, deep pistols progressions begin, wall handstands get comfortable. Volume climbs. Tendons are adapting — respect the technique day.',
    reqs: [
      { chain: 'row',    level: 'Wide Row' },
      { chain: 'pullup', level: 'Pull Up' },
      { chain: 'pushup', level: 'Diamond Push Up' },
      { chain: 'dip',    level: 'Dip' },
      { chain: 'hs',     level: 'Wall Handstand' },
      { chain: 'squat',  level: 'Bulgarian Split Squat' },
      { chain: 'hinge',  level: '90° Hip Nordic Curl' },
      { chain: 'lsit',   level: 'Tuck L-Sit' },
      { chain: 'hang',   level: 'Hanging Leg Raise' },
      { chain: 'antiext', level: 'Knees Ab Wheel' },
    ],
  },
  {
    id: 'p3', num: 'PHASE 03', name: 'ADVANCE', window: 'Month 4–6',
    story: 'Intermediate consolidation. L-pull ups, pseudo planche work, freestanding handstand attempts, nordic negatives. This is where most people stall — you will not, because the overload engine never lets a session drift.',
    reqs: [
      { chain: 'row',    level: 'Archer Row' },
      { chain: 'pullup', level: 'Chest to Bar PU' },
      { chain: 'pushup', level: 'Pseudo Planche PU' },
      { chain: 'dip',    level: 'Bulgarian Dip' },
      { chain: 'hs',     level: 'Freestanding HS' },
      { chain: 'squat',  level: 'Assisted Pistol Squat' },
      { chain: 'hinge',  level: '45° Hip Nordic Curl' },
      { chain: 'lsit',   level: 'L-Sit' },
      { chain: 'hang',   level: 'Toes to Bar' },
      { chain: 'antiext', level: 'Ab Wheel Negative' },
    ],
  },
  {
    id: 'p4', num: 'PHASE 04', name: 'MASTERY', window: 'Month 6–9',
    story: 'The goal line: advanced band in most chains. Archer pull ups, ring dips, pistol squats, wall handstand push ups, 20-second L-sits, nordic negatives becoming nordics. Elite (planche, one-arm work, front lever) stays on the chart as the horizon beyond.',
    reqs: [
      { chain: 'row',    level: 'Tuck Front Lever Row' },
      { chain: 'pullup', level: 'Archer Pull Up' },
      { chain: 'pushup', level: 'Archer Push Up' },
      { chain: 'dip',    level: 'Ring Dip' },
      { chain: 'hs',     level: 'Wall HSPU' },
      { chain: 'squat',  level: 'Pistol Squat' },
      { chain: 'hinge',  level: 'Nordic Curl Negative' },
      { chain: 'lsit',   level: 'L-Sit' },
      { chain: 'hang',   level: 'Toes to Bar' },
      { chain: 'antiext', level: 'Standing Ab Wheel' },
    ],
  },
];

/* ---------- Recovery protocol (the other half of the program) ---------- */

const RECOVERY = [
  { icon: '😴', title: 'Sleep is the program', tag: 'NON-NEGOTIABLE',
    body: '7.5–9 hours, consistent schedule. Strength is built in bed, not in the session — growth hormone pulses and tissue repair happen in deep sleep. One bad night: train anyway. Two bad nights: swap to a Technique day. Chronic short sleep will stall every chain in this app.' },
  { icon: '🥩', title: 'Protein & fuel', tag: 'DAILY',
    body: '1.6–2.2 g protein per kg bodyweight, every day, spread over 3–4 meals. Eat at maintenance or a slight surplus while learning skills — cutting hard while trying to add reps is how progress flatlines. Hydrate: performance drops measurably at 2% dehydration.' },
  { icon: '⏱️', title: 'The 48-hour rule', tag: 'SCHEDULE',
    body: 'Full-body sessions Mon/Wed/Fri (or any spacing with 48h between). Muscle protein synthesis runs ~48h after training — training sooner cuts the growth window short; much later wastes it. Never train the same chains hard on back-to-back days.' },
  { icon: '📉', title: 'Deload every 6–8 weeks', tag: 'PLANNED',
    body: 'Every 6–8 weeks — or whenever two consecutive sessions regress — take a deload week: same exercises, HALF the sets, stop 3+ reps shy of failure. You are not losing progress; you are cashing in the adaptation you paid for. You will come back stronger, guaranteed.' },
  { icon: '🦴', title: 'Tendons lag muscles', tag: 'INJURY-PROOF',
    body: 'Muscles adapt in weeks; tendons take months. This is THE bodyweight-training trap — feeling strong enough to skip levels. Sharp or joint-line pain = stop that movement, drop two levels for a week. Achy elbows/wrists respond to slow eccentrics and reduced volume, not rest alone.' },
  { icon: '🚶', title: 'Rest days are active', tag: 'OFF-DAYS',
    body: '20–30 min walking plus 10–15 min mobility: wrist prep, shoulder dislocates, deep squat sits, hamstring flossing, thoracic extensions. Light movement clears soreness faster than the couch. Save intense cardio for after strength sessions or off-days, keep it easy the day before Heavy day.' },
  { icon: '🔥', title: 'DOMS vs. injury', tag: 'KNOW THE DIFFERENCE',
    body: 'DOMS: dull, symmetric, in the muscle belly, peaks 24–48h, fades with warm-up — train through it. Injury: sharp, one-sided, at a joint or tendon, worse as the session continues — stop. When unsure, do the warm-up: DOMS improves, injuries don’t. Never test out through pain.' },
  { icon: '🧠', title: 'Stress budget', tag: 'AUTOREGULATE',
    body: 'Sleep debt, work crunch, illness — recovery is one bucket. Brutal life week? Downgrade Heavy day to Technique day, keep the schedule. The rule is: never miss a session, but any session can shrink. Consistency beats intensity over 9 months, every time.' },
  { icon: '🧊', title: 'What actually works', tag: 'EVIDENCE',
    body: 'Proven: sleep, protein, managed volume, deloads, walking. Marginal: massage, sauna, contrast showers (feel nice, small effect). Counterproductive: ice baths right after strength work can blunt the adaptation signal — save cold exposure for rest days if you love it.' },
];

/* Escape-beginner 30-day mission shown on dashboard */
const MISSION_DAYS = 30;
