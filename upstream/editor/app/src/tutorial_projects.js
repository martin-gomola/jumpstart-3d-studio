// Version 2.9.9.6: bigger projects (25-35 minutes) with several parts that work together:
// games, mechanical toys, robots, a Ferris wheel, a fidget, a lantern and flowers, using the
// newer tools too (Lattice, Expandable, Flower Studio). They range from Easy (ages 7+) to
// Advanced (ages 12+) and over different interests. Same step format as tutorial_data.js, plus:
//   ages:  who it suits (shown on the card), topic: what it's about
//   demo:  how a test can do the step (see tests/tprojtut.cjs): add a shape, copy, group…
import { nameStep, saveStep, exportStep, FIELDS, TABS } from "./tutorial_data.js";

const near = (a, b, tol = 1) => Math.abs((+a || 0) - b) <= tol;
const P = (t, kind, hole, fn) => t.prim(kind, hole).filter((b) => fn(b.node.p, b));
const has = (t, kind, hole, fn, n = 1) => P(t, kind, hole, fn).length >= n;
// any shape, inside a group or not, of this kind and size (groups keep their shapes)
const all = (t) => { const out = []; const go = (b) => { out.push(b); for (const c of b.node.children || []) go(c); }; for (const b of t.bodies()) go(b); return out; };
const deep = (t, kind, hole, fn, n = 1) => all(t).filter((b) => b.node.t === "prim" && b.node.kind === kind && !!b.hole === !!hole && fn(b.node.p, b)).length >= n;
const groupWith = (t, kinds, holes = 0, n = 1) => t.groups().filter((g) => { const k = t.childKinds(g); return kinds.every((x) => k.includes(x)) && t.countHoles(g) >= holes; }).length >= n;
const flowers = (t) => t.bodies().filter((b) => b.flower);
const rings = (t) => t.bodies().filter((b) => b.expand);
const lattice = (t, curved) => all(t).some((b) => (b.node.mods || []).some((m) => m.t === "facepat" && m.lattice && (curved == null || !!m.curved === curved)));
const ROT = (axis) => `Under <b>Rotate 90°</b>, click <b>↻ ${axis}</b> once.`;
const MENU = (menu, item) => `Open <b>${menu} ▾</b> in the toolbar and click <b>${item}</b>.`;
const PRINTSIM = {
  title: "Check it in the 3D Print Sim", tool: "3D Print Sim", icon: "printsim", show: { sel: "#bb-printsim" },
  how: ["Click <b>3D Print Sim</b> in the toolbar.", "Look at the print time and the red areas that need support. Click <b>Close</b> (or the ✕) when you're done."],
  when: "Before printing a project with many parts, see how long it takes and whether any part needs supports.",
};

export const PROJECT_TUTORIALS = [
  // ============================================================== 1. Tic-tac-toe (Easy, games)
  {
    id: "b-proj-tictactoe", mode: "beginner", level: "Easy", minutes: "25-30", item: "Tic-Tac-Toe Game", ages: "8+", topic: "Games",
    title: "Travel tic-tac-toe",
    blurb: "A pocket game board with a grooved grid and nine shallow dips, plus five X pieces and five O pieces that sit in the dips. A first multi-part project: one board, ten pieces, all printed together.",
    learn: ["Box", "Box holes (grooves)", "Cylinder holes", "Pattern (rows)", "Text", "Tube", "Group"],
    steps: [
      nameStep("Tic-Tac-Toe Game", "Lopez, Maria, Tic-Tac-Toe Game"),
      {
        title: "The board", tool: "Box", icon: "box", show: { tile: "box" }, anim: "tile",
        how: ["Click the <b>Box</b> tile.", FIELDS, "Size: <b>Width 96</b>, <b>Depth 96</b>, <b>Height 6</b>. Position: <b>X 0</b>, <b>Y 0</b>, <b>Z 0</b>."],
        when: "The board is three squares of 32 mm each way: big enough for fingers, small enough for a pocket.",
        check: (t) => has(t, "box", false, (p) => near(p.w, 96) && near(p.d, 96) && near(p.h, 6)),
        demo: { add: "box", p: { w: 96, d: 96, h: 6 }, at: [0, 0, 0] },
      },
      {
        title: "A groove across", tool: "Holes → Box", icon: "holeToggle", show: { tile: "box", hole: true }, anim: "holeBox",
        how: ["Click <b>Holes</b>, then the <b>Box</b> tile.", "Size: <b>Width 90</b>, <b>Depth 2</b>, <b>Height 2</b>. Position: <b>X 0</b>, <b>Y 16</b>, <b>Z 4.5</b>."],
        when: "A groove 1.5 mm deep draws the grid line. It sits a little into the top (Z 4.5 + 2 reaches above the board), so it cuts cleanly.",
        check: (t) => has(t, "box", true, (p) => near(p.w, 90) && near(p.d, 2, 0.4)) || has(t, "box", true, (p) => near(p.d, 90) && near(p.w, 2, 0.4)),
        demo: { add: "box", hole: true, p: { w: 90, d: 2, h: 2 }, at: [0, 16, 4.5] },
      },
      {
        title: "Three more grooves", tool: "Duplicate (Ctrl+D)", icon: "duplicate", show: { sel: "#bb-dup" },
        how: ["With the groove selected, press <b>Ctrl+D</b> to copy it and set <b>Y -16</b>.", "Copy it again: this time set <b>Width 2</b>, <b>Depth 90</b>, <b>X 16</b>, <b>Y 0</b>.", "Copy that one and set <b>X -16</b>. You now have a # grid."],
        when: "Duplicate keeps every size, so you only change what's different.",
        check: (t) => P(t, "box", true, (p) => (near(p.w, 90) && near(p.d, 2, 0.4)) || (near(p.d, 90) && near(p.w, 2, 0.4))).length >= 4,
        demo: [{ add: "box", hole: true, p: { w: 90, d: 2, h: 2 }, at: [0, -16, 4.5] }, { add: "box", hole: true, p: { w: 2, d: 90, h: 2 }, at: [16, 0, 4.5] }, { add: "box", hole: true, p: { w: 2, d: 90, h: 2 }, at: [-16, 0, 4.5] }],
      },
      {
        title: "A dip for a piece", tool: "Holes → Cylinder", icon: "holeToggle", show: { tile: "cylinder", hole: true }, anim: "holeBox",
        how: ["Add a <b>Cylinder</b> hole: <b>Width 24</b>, <b>Depth 24</b>, <b>Height 3</b>.", "Position: <b>X -32</b>, <b>Y -32</b>, <b>Z 4.5</b> (the bottom-left square)."],
        when: "The pieces are 22 mm across, so a 24 mm dip, 1.5 mm deep, holds them without wobbling on a bumpy car ride.",
        check: (t) => has(t, "cylinder", true, (p) => near(p.w, 24, 0.6)),
        demo: { add: "cylinder", hole: true, p: { w: 24, d: 24, h: 3 }, at: [-32, -32, 4.5] },
      },
      {
        title: "Nine dips with Pattern", tool: "Arrange ▾ → Pattern", icon: "pattern", show: { sel: "#bb-pattern" },
        how: ["Select the dip.", MENU("Arrange", "Pattern"), TABS, "Type <b>Rectangular</b>. Direction 1: <b>Along X</b>, <b>Count 3</b>, <b>Spacing 32</b>. Direction 2: <b>Along Y</b>, <b>Count 3</b>, <b>Spacing 32</b>.", "Click <b>OK</b>: 9 dips, one in every square."],
        when: "A rectangular pattern copies in two directions at once: rows and columns.",
        check: (t) => P(t, "cylinder", true, (p) => near(p.w, 24, 0.6)).length >= 9,
        demo: { grid: [3, 3], dx: 32, dy: 32 },
      },
      {
        title: "Group the board", tool: "Group", icon: "group", show: { sel: "#bb-group" },
        how: ["Press <b>Ctrl+A</b> to select everything, then click <b>Group</b>.", "The grooves and dips cut into the board."],
        when: "Grouping turns holes into real cuts. Do it before you make the pieces, so they stay separate.",
        check: (t) => t.groups().some((g) => t.countHoles(g) >= 13),
        demo: { group: "all" },
      },
      {
        title: "An X piece", tool: "Text", icon: "text", show: { tile: "text" }, anim: "tile",
        how: ["Click the <b>Text</b> tile and type <b>X</b> in its text box.", "Size <b>24</b>, Height <b>5</b>. Position: <b>X -30</b>, <b>Y 80</b>, <b>Z 0</b>."],
        when: "A letter makes a perfect X. Thick (5 mm) pieces are easy to pick up.",
        check: (t) => t.prim("text").some((b) => /x/i.test(b.node.p.text || "")),
        demo: { add: "text", p: { text: "X", size: 24, h: 5 }, at: [-30, 80, 0] },
      },
      {
        title: "Five X pieces", tool: "Arrange ▾ → Pattern", icon: "pattern", show: { sel: "#bb-pattern" },
        how: ["Select the X.", MENU("Arrange", "Pattern"), "<b>Rectangular</b>, <b>Along X</b>, <b>Count 5</b>, <b>Spacing 28</b>. <b>OK</b>."],
        check: (t) => t.prim("text").filter((b) => /x/i.test(b.node.p.text || "")).length >= 5,
        demo: { row: 5, dx: 28 },
      },
      {
        title: "An O piece", tool: "Tube", icon: "tube", show: { tile: "tube" }, anim: "tile",
        how: ["Click the <b>Tube</b> tile.", "Size: <b>Width 22</b>, <b>Depth 22</b>, <b>Height 5</b>, Wall <b>4</b>. Position: <b>X -30</b>, <b>Y 115</b>, <b>Z 0</b>."],
        when: "A tube is a ring: the O.",
        check: (t) => has(t, "tube", false, (p) => near(p.w, 22, 1)),
        demo: { add: "tube", p: { w: 22, d: 22, h: 5, wall: 4 }, at: [-30, 115, 0] },
      },
      {
        title: "Five O pieces", tool: "Arrange ▾ → Pattern", icon: "pattern", show: { sel: "#bb-pattern" },
        how: ["Select the O and pattern it the same way: <b>Along X</b>, <b>Count 5</b>, <b>Spacing 28</b>."],
        when: "Tip: give the X pieces and O pieces different colours (Color in the right panel), and print them in two colours if your printer can.",
        check: (t) => P(t, "tube", false, (p) => near(p.w, 22, 1)).length >= 5,
        demo: { row: 5, dx: 28 },
      },
      PRINTSIM,
      saveStep(),
      exportStep(),
    ],
  },
  // ============================================================== 2. Rubber-band racer (Proficient, toys & machines)
  {
    id: "b-proj-racer", mode: "beginner", level: "Proficient", minutes: "30-35", item: "Rubber Band Racer", ages: "10+", topic: "Toys & machines",
    title: "Rubber-band racer",
    blurb: "A car that drives itself: wind a rubber band round the back axle and let go. A chassis with axle mounts, four press-fit wheels with grippy tread, two axles and a hook for the band.",
    learn: ["Box", "Capsule", "Holes that fit (clearance)", "Rotate 90°", "Texture", "Pattern", "Text", "Group"],
    steps: [
      nameStep("Rubber Band Racer", "Lopez, Maria, Rubber Band Racer"),
      {
        title: "The chassis", tool: "Box", icon: "box", show: { tile: "box" }, anim: "tile",
        how: ["Add a <b>Box</b>: <b>Width 50</b>, <b>Depth 120</b>, <b>Height 6</b>. Position <b>X 0</b>, <b>Y 0</b>, <b>Z 0</b>."],
        when: "The car points along Y: front at the back of the screen, rear toward you.",
        check: (t) => has(t, "box", false, (p) => near(p.w, 50) && near(p.d, 120) && near(p.h, 6)),
        demo: { add: "box", p: { w: 50, d: 120, h: 6 }, at: [0, 0, 0] },
      },
      {
        title: "Two axle mounts", tool: "Box", icon: "box", show: { tile: "box" }, anim: "tile",
        how: ["Add a <b>Box</b>: <b>Width 50</b>, <b>Depth 10</b>, <b>Height 16</b>. Position <b>X 0</b>, <b>Y -48</b>, <b>Z 0</b> (the rear).", "Copy it (<b>Ctrl+D</b>) and set <b>Y 48</b> (the front)."],
        when: "The mounts lift the axles so the wheels clear the chassis.",
        check: (t) => P(t, "box", false, (p) => near(p.w, 50) && near(p.d, 10) && near(p.h, 16)).length >= 2,
        demo: [{ add: "box", p: { w: 50, d: 10, h: 16 }, at: [0, -48, 0] }, { add: "box", p: { w: 50, d: 10, h: 16 }, at: [0, 48, 0] }],
      },
      {
        title: "Holes for the axles", tool: "Holes → Capsule", icon: "holeToggle", show: { tile: "capsule", hole: true }, anim: "holeBox",
        how: ["Add a <b>Capsule</b> hole: <b>Width 60</b>, <b>Depth 5.6</b>, <b>Height 5.6</b>. It lies along X, through both sides of a mount.", "Position <b>X 0</b>, <b>Y -48</b>, <b>Z 8</b>.", "Copy it and set <b>Y 48</b>."],
        when: "The axles are 5 mm thick; 5.6 mm holes give 0.3 mm all round so they spin freely.",
        check: (t) => P(t, "capsule", true, (p) => near(p.d, 5.6, 0.5)).length >= 2,
        demo: [{ add: "capsule", hole: true, p: { w: 60, d: 5.6, h: 5.6 }, at: [0, -48, 8] }, { add: "capsule", hole: true, p: { w: 60, d: 5.6, h: 5.6 }, at: [0, 48, 8] }],
      },
      {
        title: "A hook for the band", tool: "Cylinder", icon: "cylinder", show: { tile: "cylinder" }, anim: "tile",
        how: ["Add a <b>Cylinder</b>: <b>Width 6</b>, <b>Depth 6</b>, <b>Height 14</b>. Position <b>X 0</b>, <b>Y 30</b>, <b>Z 6</b>."],
        when: "The rubber band loops over this post and winds round the rear axle.",
        check: (t) => has(t, "cylinder", false, (p) => near(p.w, 6, 0.6) && near(p.h, 14, 1)),
        demo: { add: "cylinder", p: { w: 6, d: 6, h: 14 }, at: [0, 30, 6] },
      },
      {
        title: "Your name on top", tool: "Text", icon: "text", show: { tile: "text" }, anim: "tile",
        how: ["Add <b>Text</b> with your first name: Size <b>9</b>, Height <b>1.2</b>. Position <b>X 0</b>, <b>Y 0</b>, <b>Z 6</b>."],
        check: (t) => t.prim("text").some((b) => near(b.node.p.h, 1.2, 0.5)),
        demo: { add: "text", p: { text: "MARIA", size: 9, h: 1.2 }, at: [0, 0, 6] },
      },
      {
        title: "Group the chassis", tool: "Group", icon: "group", show: { sel: "#bb-group" },
        how: ["<b>Ctrl+A</b>, then <b>Group</b>."],
        check: (t) => t.groups().some((g) => t.countHoles(g) >= 2 && t.childKinds(g).includes("capsule")),
        demo: { group: "all" },
      },
      {
        title: "A wheel", tool: "Cylinder", icon: "cylinder", show: { tile: "cylinder" }, anim: "tile",
        how: ["Add a <b>Cylinder</b>: <b>Width 40</b>, <b>Depth 40</b>, <b>Height 6</b>. Position <b>X 80</b>, <b>Y -40</b>, <b>Z 0</b>.", "Add a <b>Cylinder</b> hole: <b>Width 4.8</b>, <b>Depth 4.8</b>, <b>Height 6</b>, at the same X and Y."],
        when: "The wheel's hole is a little smaller than the axle (4.8 mm for 5 mm): a press fit, so the wheel grips the axle and turns with it.",
        check: (t) => has(t, "cylinder", false, (p) => near(p.w, 40) && near(p.h, 6, 0.6)) && has(t, "cylinder", true, (p) => near(p.w, 4.8, 0.3)),
        demo: [{ add: "cylinder", p: { w: 40, d: 40, h: 6 }, at: [80, -40, 0] }, { add: "cylinder", hole: true, p: { w: 4.8, d: 4.8, h: 6 }, at: [80, -40, 0] }],
      },
      {
        title: "Grip on the tyre", tool: "Shape it ▾ → Texture", icon: "texture", show: { sel: "#bb-texture" },
        how: ["Select the wheel (not its hole).", MENU("Shape it", "Texture"), "Pick a grippy texture like <b>Knurl</b> or <b>Diamond</b> and click its round edge (the side), then <b>OK</b>."],
        when: "A textured tread grips the floor instead of spinning.",
        check: (t) => t.bodies().some((b) => (b.textures || []).length > 0) || all(t).some((b) => (b.textures || []).length > 0),
        demo: { texture: "knurl" },
      },
      {
        title: "Group the wheel, then make four", tool: "Group, Arrange ▾ → Pattern", icon: "pattern", show: { sel: "#bb-group" },
        how: ["Select the wheel and its hole (drag a box round them) and click <b>Group</b>.", MENU("Arrange", "Pattern"), "<b>Along Y</b>, <b>Count 4</b>, <b>Spacing 46</b>. <b>OK</b>."],
        check: (t) => t.groups().filter((g) => t.childKinds(g).includes("cylinder") && t.countHoles(g) >= 1 && near((t.box(g.id) || { size: { x: 0 } }).size.x, 40, 2)).length >= 4,
        demo: [{ group: 2 }, { row: 4, dy: 46 }],
      },
      {
        title: "Two axles", tool: "Capsule", icon: "capsule", show: { tile: "capsule" }, anim: "tile",
        how: ["Add a <b>Capsule</b>: <b>Width 66</b>, <b>Depth 5</b>, <b>Height 5</b>. Position <b>X 0</b>, <b>Y 90</b>, <b>Z 0</b>.", "Copy it and set <b>Y 100</b>."],
        when: "Rounded ends slide through the holes easily and look neat. They print lying down, which makes them strong.",
        check: (t) => P(t, "capsule", false, (p) => near(p.w, 66, 1) && near(p.d, 5, 0.4)).length >= 2,
        demo: [{ add: "capsule", p: { w: 66, d: 5, h: 5 }, at: [0, 90, 0] }, { add: "capsule", p: { w: 66, d: 5, h: 5 }, at: [0, 100, 0] }],
      },
      PRINTSIM,
      saveStep(),
      exportStep(),
    ],
  },
  // ============================================================== 3. Bobble-head robot (Proficient, robots)
  {
    id: "b-proj-bobblebot", mode: "beginner", level: "Proficient", minutes: "25-30", item: "Bobble Bot", ages: "9+", topic: "Robots",
    title: "Bobble-head robot",
    blurb: "A friendly robot whose head bobs on a printed spring: a boxy body with arms, a head with eyes, a mouth and an antenna, and a spring that pushes into both.",
    learn: ["Box", "Sphere", "Capsule", "Spring", "Holes", "Group", "Colour"],
    steps: [
      nameStep("Bobble Bot", "Lopez, Maria, Bobble Bot"),
      {
        title: "Feet", tool: "Box", icon: "box", show: { tile: "box" }, anim: "tile",
        how: ["Add a <b>Box</b>: <b>Width 46</b>, <b>Depth 34</b>, <b>Height 6</b> at <b>X 0</b>, <b>Y 0</b>, <b>Z 0</b>."],
        check: (t) => deep(t, "box", false, (p) => near(p.w, 46) && near(p.d, 34) && near(p.h, 6)),
        demo: { add: "box", p: { w: 46, d: 34, h: 6 }, at: [0, 0, 0] },
      },
      {
        title: "Body", tool: "Box", icon: "box", show: { tile: "box" }, anim: "tile",
        how: ["Add a <b>Box</b>: <b>Width 40</b>, <b>Depth 30</b>, <b>Height 44</b> at <b>Z 6</b>.", "Round its corners a little: <b>Radius 3</b> in the right panel."],
        check: (t) => deep(t, "box", false, (p) => near(p.w, 40) && near(p.d, 30) && near(p.h, 44)),
        demo: { add: "box", p: { w: 40, d: 30, h: 44, r: 3 }, at: [0, 0, 6] },
      },
      {
        title: "Arms", tool: "Capsule", icon: "capsule", show: { tile: "capsule" }, anim: "tile",
        how: ["Add a <b>Capsule</b>: <b>Width 62</b>, <b>Depth 10</b>, <b>Height 10</b> at <b>X 0</b>, <b>Y 0</b>, <b>Z 30</b>. It pokes out both sides as arms."],
        check: (t) => deep(t, "capsule", false, (p) => near(p.w, 62, 1.5)),
        demo: { add: "capsule", p: { w: 62, d: 10, h: 10 }, at: [0, 0, 30] },
      },
      {
        title: "A hole for the spring", tool: "Holes → Cylinder", icon: "holeToggle", show: { tile: "cylinder", hole: true }, anim: "holeBox",
        how: ["Add a <b>Cylinder</b> hole: <b>Width 15</b>, <b>Depth 15</b>, <b>Height 6</b> at <b>X 0</b>, <b>Y 0</b>, <b>Z 45</b>."],
        when: "The spring's end pushes into this pocket on top of the body.",
        check: (t) => deep(t, "cylinder", true, (p) => near(p.w, 15, 0.6)),
        demo: { add: "cylinder", hole: true, p: { w: 15, d: 15, h: 6 }, at: [0, 0, 45] },
      },
      {
        title: "Group the body", tool: "Group", icon: "group", show: { sel: "#bb-group" },
        how: ["<b>Ctrl+A</b>, <b>Group</b>."],
        check: (t) => groupWith(t, ["box", "capsule"], 1),
        demo: { group: "all" },
      },
      {
        title: "The head", tool: "Box", icon: "box", show: { tile: "box" }, anim: "tile",
        how: ["Add a <b>Box</b>: <b>Width 36</b>, <b>Depth 30</b>, <b>Height 28</b> at <b>X 70</b>, <b>Y 0</b>, <b>Z 0</b> (beside the body: it prints separately)."],
        check: (t) => deep(t, "box", false, (p) => near(p.w, 36) && near(p.d, 30) && near(p.h, 28)),
        demo: { add: "box", p: { w: 36, d: 30, h: 28 }, at: [70, 0, 0] },
      },
      {
        title: "Eyes", tool: "Sphere", icon: "sphere", show: { tile: "sphere" }, anim: "tile",
        how: ["Add a <b>Sphere</b>: <b>Width 9</b>, <b>Depth 9</b>, <b>Height 9</b> at <b>X 62</b>, <b>Y -15</b>, <b>Z 14</b>.", "Copy it and set <b>X 78</b>. Give the eyes a bright colour."],
        check: (t) => all(t).filter((b) => b.node.kind === "sphere" && !b.hole && near(b.node.p.w, 9, 1)).length >= 2,
        demo: [{ add: "sphere", p: { w: 9, d: 9, h: 9 }, at: [62, -15, 14] }, { add: "sphere", p: { w: 9, d: 9, h: 9 }, at: [78, -15, 14] }],
      },
      {
        title: "Mouth and antenna", tool: "Box hole, Cylinder, Sphere", icon: "holeToggle", show: { tile: "box", hole: true },
        how: ["A <b>Box</b> hole for the mouth: <b>Width 16</b>, <b>Depth 6</b>, <b>Height 3</b> at <b>X 70</b>, <b>Y -15</b>, <b>Z 6</b>.", "An antenna: a <b>Cylinder</b> <b>Width 3</b>, <b>Height 14</b> at <b>X 70</b>, <b>Y 0</b>, <b>Z 28</b>, and a <b>Sphere</b> <b>Width 8</b> on top at <b>Z 40</b>."],
        check: (t) => deep(t, "box", true, (p) => near(p.w, 16, 1)) && deep(t, "cylinder", false, (p) => near(p.w, 3, 0.5)),
        demo: [{ add: "box", hole: true, p: { w: 16, d: 6, h: 3 }, at: [70, -15, 6] }, { add: "cylinder", p: { w: 3, d: 3, h: 14 }, at: [70, 0, 28] }, { add: "sphere", p: { w: 8, d: 8, h: 8 }, at: [70, 0, 40] }],
      },
      {
        title: "A pocket under the head", tool: "Holes → Cylinder", icon: "holeToggle", show: { tile: "cylinder", hole: true },
        how: ["Add a <b>Cylinder</b> hole <b>Width 15</b>, <b>Height 6</b> at <b>X 70</b>, <b>Y 0</b>, <b>Z -1</b>. The spring's other end goes in here."],
        check: (t) => all(t).filter((b) => b.node.kind === "cylinder" && b.hole && near(b.node.p.w, 15, 0.6)).length >= 2,
        demo: { add: "cylinder", hole: true, p: { w: 15, d: 15, h: 6 }, at: [70, 0, -1] },
      },
      {
        title: "Group the head", tool: "Group", icon: "group", show: { sel: "#bb-group" },
        how: ["Drag a box round the head and its parts (not the body), then <b>Group</b>."],
        check: (t) => t.groups().length >= 2 && groupWith(t, ["box", "sphere", "cylinder"], 2),
        demo: { group: 6 },
      },
      {
        title: "The bobble spring", tool: "Spring", icon: "coil", show: { tile: "spring" }, anim: "tile",
        how: ["Add a <b>Spring</b>: <b>Width 14</b>, <b>Depth 14</b>, <b>Height 26</b>, <b>Turns 5</b>, <b>Wire 2.4</b> at <b>X 130</b>, <b>Y 0</b>, <b>Z 0</b>."],
        when: "14 mm wide fits snugly in the 15 mm pockets. A printed PLA spring bounces nicely; PETG bounces even more.",
        check: (t) => t.prim("spring").some((b) => near(b.node.p.w, 14, 1.5)),
        demo: { add: "spring", p: { w: 14, d: 14, h: 26, turns: 5, wire: 2.4 }, at: [130, 0, 0] },
      },
      saveStep(),
      exportStep(),
    ],
  },
  // ============================================================== 4. Ferris wheel (Advanced, machines)
  {
    id: "b-proj-ferris", mode: "beginner", level: "Advanced", minutes: "30-35", item: "Ferris Wheel", ages: "12+", topic: "Machines & engineering",
    title: "Ferris wheel that turns",
    blurb: "Two wheel sides with spokes, eight swinging cabins on rods, an axle and two A-frame stands. Every part prints flat and they slot together, and the wheel really turns while the cabins stay level.",
    learn: ["Torus", "Circular Pattern", "Holes that fit", "Roof shape", "Rotate 90°", "Group", "Duplicate", "Assembly"],
    steps: [
      nameStep("Ferris Wheel", "Lopez, Maria, Ferris Wheel"),
      {
        title: "The rim", tool: "Torus", icon: "torus", show: { tile: "torus" }, anim: "tile",
        how: ["Add a <b>Torus</b>: <b>Width 140</b>, <b>Depth 140</b>, <b>Height 6</b> (its tube is 6 mm thick). Position <b>X 0</b>, <b>Y 0</b>, <b>Z 0</b>."],
        check: (t) => deep(t, "torus", false, (p) => near(p.w, 140, 3)),
        demo: { add: "torus", p: { w: 140, d: 140, h: 6, tube: 6 }, at: [0, 0, 0] },
      },
      {
        title: "The hub", tool: "Cylinder", icon: "cylinder", show: { tile: "cylinder" }, anim: "tile",
        how: ["Add a <b>Cylinder</b>: <b>Width 22</b>, <b>Depth 22</b>, <b>Height 6</b> at <b>X 0</b>, <b>Y 0</b>, <b>Z 0</b>."],
        check: (t) => deep(t, "cylinder", false, (p) => near(p.w, 22, 1) && near(p.h, 6, 1)),
        demo: { add: "cylinder", p: { w: 22, d: 22, h: 6 }, at: [0, 0, 0] },
      },
      {
        title: "One spoke", tool: "Box", icon: "box", show: { tile: "box" }, anim: "tile",
        how: ["Add a <b>Box</b>: <b>Width 60</b>, <b>Depth 4</b>, <b>Height 4</b> at <b>X 38</b>, <b>Y 0</b>, <b>Z 0</b>. It runs from the hub out to the rim."],
        check: (t) => deep(t, "box", false, (p) => near(p.w, 60, 1) && near(p.d, 4, 0.5)),
        demo: { add: "box", p: { w: 60, d: 4, h: 4 }, at: [38, 0, 0] },
      },
      {
        title: "Eight spokes", tool: "Arrange ▾ → Pattern (circular)", icon: "pattern", show: { sel: "#bb-pattern" },
        how: ["Select the spoke.", MENU("Arrange", "Pattern"), TABS, "Type <b>Circular</b>, Around <b>Z</b>, Through <b>Origin</b>, <b>Count 8</b>, <b>Total angle 360</b>. <b>OK</b>."],
        when: "Eight spokes 45° apart: a circular pattern is how you make anything round and even.",
        check: (t) => all(t).filter((b) => b.node.kind === "box" && !b.hole && near(b.node.p.w, 60, 1) && near(b.node.p.d, 4, 0.5)).length >= 8,
        demo: { circle: 8 },
      },
      {
        title: "A hole for a cabin rod", tool: "Holes → Cylinder", icon: "holeToggle", show: { tile: "cylinder", hole: true },
        how: ["Add a <b>Cylinder</b> hole: <b>Width 4.4</b>, <b>Depth 4.4</b>, <b>Height 8</b> at <b>X 70</b>, <b>Y 0</b>, <b>Z -1</b> (on the rim)."],
        when: "The cabin rods are 4 mm; 4.4 mm holes let them push in by hand.",
        check: (t) => deep(t, "cylinder", true, (p) => near(p.w, 4.4, 0.3)),
        demo: { add: "cylinder", hole: true, p: { w: 4.4, d: 4.4, h: 8 }, at: [70, 0, -1] },
      },
      {
        title: "Eight rod holes", tool: "Arrange ▾ → Pattern (circular)", icon: "pattern", show: { sel: "#bb-pattern" },
        how: ["Pattern the rod hole just like the spokes: <b>Circular</b>, <b>Count 8</b>, <b>360</b>. The holes land on the ends of the spokes."],
        check: (t) => all(t).filter((b) => b.node.kind === "cylinder" && b.hole && near(b.node.p.w, 4.4, 0.3)).length >= 8,
        demo: { circle: 8 },
      },
      {
        title: "The axle hole and group", tool: "Holes → Cylinder, Group", icon: "group", show: { sel: "#bb-group" },
        how: ["Add a <b>Cylinder</b> hole <b>Width 8.4</b>, <b>Height 8</b> at <b>X 0</b>, <b>Y 0</b>, <b>Z -1</b>.", "Press <b>Ctrl+A</b> and <b>Group</b>: one side of the wheel."],
        check: (t) => t.groups().some((g) => t.childKinds(g).includes("torus") && t.countHoles(g) >= 9),
        demo: [{ add: "cylinder", hole: true, p: { w: 8.4, d: 8.4, h: 8 }, at: [0, 0, -1] }, { group: "all" }],
      },
      {
        title: "The other side", tool: "Duplicate (Ctrl+D)", icon: "duplicate", show: { sel: "#bb-dup" },
        how: ["With the wheel selected, press <b>Ctrl+D</b> and set <b>X 160</b>."],
        when: "Both sides are the same, so one copy is all it takes.",
        check: (t) => t.groups().filter((g) => t.childKinds(g).includes("torus")).length >= 2,
        demo: { copy: 1, dx: 160 },
      },
      {
        title: "A cabin", tool: "Tube, Box, Capsule hole", icon: "tube", show: { tile: "tube" },
        how: ["A cup: <b>Tube</b> <b>Width 22</b>, <b>Height 16</b>, Wall <b>2</b> at <b>X -120</b>, <b>Y 0</b>, <b>Z 0</b>. Add a <b>Cylinder</b> <b>Width 22</b>, <b>Height 2</b> at the same place for its floor.", "A handle across it: <b>Box</b> <b>Width 4</b>, <b>Depth 22</b>, <b>Height 28</b> at <b>X -120</b>, <b>Y 0</b>, <b>Z 0</b>.", "A <b>Capsule</b> hole through the handle top: <b>Width 10</b>, <b>Depth 4.8</b>, <b>Height 4.8</b> at <b>X -120</b>, <b>Y 0</b>, <b>Z 21</b>.", "Select the four and <b>Group</b>."],
        when: "The rod passes through the handle's hole, so the cabin hangs from it and swings level as the wheel turns.",
        check: (t) => groupWith(t, ["tube", "box", "capsule"], 1),
        demo: [{ add: "tube", p: { w: 22, d: 22, h: 16, wall: 2 }, at: [-120, 0, 0] }, { add: "cylinder", p: { w: 22, d: 22, h: 2 }, at: [-120, 0, 0] }, { add: "box", p: { w: 4, d: 22, h: 28 }, at: [-120, 0, 0] }, { add: "capsule", hole: true, p: { w: 10, d: 4.8, h: 4.8 }, at: [-120, 0, 21] }, { group: 4 }],
      },
      {
        title: "Eight cabins", tool: "Arrange ▾ → Pattern", icon: "pattern", show: { sel: "#bb-pattern" },
        how: ["Select the cabin and pattern it: <b>Along Y</b>, <b>Count 8</b>, <b>Spacing 28</b>. Give each a fun colour if you like."],
        check: (t) => t.groups().filter((g) => t.childKinds(g).includes("tube")).length >= 8,
        demo: { row: 8, dy: 28 },
      },
      {
        title: "Axle and rods", tool: "Capsule", icon: "capsule", show: { tile: "capsule" },
        how: ["The axle: <b>Capsule</b> <b>Width 52</b>, <b>Depth 8</b>, <b>Height 8</b> at <b>X 0</b>, <b>Y -110</b>, <b>Z 0</b>.", "One rod: <b>Capsule</b> <b>Width 40</b>, <b>Depth 4</b>, <b>Height 4</b> at <b>X 0</b>, <b>Y -125</b>, <b>Z 0</b>, then pattern it <b>Along Y</b>, <b>Count 8</b>, <b>Spacing 8</b>."],
        when: "The 8 mm axle spins in the 8.4 mm hub holes; each 40 mm rod spans the gap between the two wheel sides and carries a cabin.",
        check: (t) => deep(t, "capsule", false, (p) => near(p.w, 52, 2) && near(p.d, 8, 0.6)) && all(t).filter((b) => b.node.kind === "capsule" && !b.hole && near(b.node.p.w, 40, 1.5)).length >= 8,
        demo: [{ add: "capsule", p: { w: 52, d: 8, h: 8 }, at: [0, -110, 0] }, { add: "capsule", p: { w: 40, d: 4, h: 4 }, at: [0, -125, 0] }, { row: 8, dy: -8 }],
      },
      {
        title: "A-frame stand", tool: "Roof, Roof hole, Cylinder hole", icon: "box", show: { tile: "roof" },
        how: ["<b>Roof</b>: <b>Width 150</b>, <b>Depth 8</b>, <b>Height 120</b> at <b>X 0</b>, <b>Y 120</b>, <b>Z 0</b>.", "A <b>Roof</b> hole inside it: <b>Width 100</b>, <b>Depth 12</b>, <b>Height 80</b> at <b>X 0</b>, <b>Y 120</b>, <b>Z 0</b>: now it's an A-frame.", "The axle hole: <b>Cylinder</b> hole <b>Width 8.6</b>, <b>Height 16</b>. " + ROT("X") + " Then set <b>X 0</b>, <b>Y 120</b>, <b>Z 98</b>.", "Select the three, <b>Group</b>, and <b>Ctrl+D</b> a second stand at <b>Y 150</b>."],
        when: "The frame prints standing up like a letter A. The axle rests in the holes at the top of both stands.",
        check: (t) => t.groups().filter((g) => t.childKinds(g).includes("roof") && t.countHoles(g) >= 2).length >= 2,
        demo: [{ add: "roof", p: { w: 150, d: 8, h: 120 }, at: [0, 120, 0] }, { add: "roof", hole: true, p: { w: 100, d: 12, h: 80 }, at: [0, 120, 0] }, { add: "cylinder", hole: true, p: { w: 8.6, d: 8.6, h: 16 }, at: [0, 120, 98], rot: ["x"] }, { group: 3 }, { copy: 1, dy: 30 }],
      },
      {
        title: "Put it together (after printing)", tool: "Assembly", icon: "group",
        how: ["Push the axle through one wheel side, the other side and the stands.", "Hang a cabin on each rod (through the handle hole), then push the rod ends into the holes in both wheel sides.", "Spin the wheel: the cabins swing and stay upright."],
        when: "Real engineers design parts that fit: every hole here is 0.2-0.4 mm bigger than what goes in it.",
      },
      PRINTSIM,
      saveStep(),
      exportStep(),
    ],
  },
  // ============================================================== 5. Expandable ghost (Easy, fidget toys)
  {
    id: "b-proj-ghost", mode: "beginner", level: "Easy", minutes: "25-30", item: "Stretchy Ghost", ages: "7+", topic: "Fidget toys",
    title: "Stretchy ghost fidget",
    blurb: "A friendly ghost made from a few shapes, turned into a fidget toy with the Expandable tool: rings that slide out and back, printed in one piece. Watch it stretch in the simulation before you print it.",
    learn: ["Cylinder", "Hemisphere", "Sphere holes", "Group", "Expandable", "Simulation"],
    steps: [
      nameStep("Stretchy Ghost", "Lopez, Maria, Stretchy Ghost"),
      {
        title: "The body", tool: "Cylinder", icon: "cylinder", show: { tile: "cylinder" }, anim: "tile",
        how: ["Add a <b>Cylinder</b>: <b>Width 50</b>, <b>Depth 50</b>, <b>Height 44</b> at <b>X 0</b>, <b>Y 0</b>, <b>Z 0</b>."],
        when: "Straight sides are what the rings slide along, so the body is a cylinder.",
        check: (t) => deep(t, "cylinder", false, (p) => near(p.w, 50, 1) && near(p.h, 44, 1)) || rings(t).length > 0,
        demo: { add: "cylinder", p: { w: 50, d: 50, h: 44 }, at: [0, 0, 0] },
      },
      {
        title: "The head", tool: "Hemisphere", icon: "sphere", show: { tile: "hemisphere" }, anim: "tile",
        how: ["Add a <b>Hemisphere</b>: <b>Width 50</b>, <b>Depth 50</b>, <b>Height 26</b> at <b>X 0</b>, <b>Y 0</b>, <b>Z 44</b>, right on top."],
        check: (t) => deep(t, "hemisphere", false, (p) => near(p.w, 50, 1)) || rings(t).length > 0,
        demo: { add: "hemisphere", p: { w: 50, d: 50, h: 26 }, at: [0, 0, 44] },
      },
      {
        title: "Eyes", tool: "Holes → Sphere", icon: "holeToggle", show: { tile: "sphere", hole: true },
        how: ["Add a <b>Sphere</b> hole <b>Width 9</b> at <b>X -9</b>, <b>Y -25</b>, <b>Z 48</b>.", "Copy it (<b>Ctrl+D</b>) and set <b>X 9</b>."],
        when: "Holes that only go a little way in make dents: eyes you can feel.",
        check: (t) => all(t).filter((b) => b.node.kind === "sphere" && b.hole).length >= 2 || rings(t).length > 0,
        demo: [{ add: "sphere", hole: true, p: { w: 9, d: 9, h: 9 }, at: [-9, -25, 48] }, { add: "sphere", hole: true, p: { w: 9, d: 9, h: 9 }, at: [9, -25, 48] }],
      },
      {
        title: "A happy mouth", tool: "Holes → Sphere", icon: "holeToggle", show: { tile: "sphere", hole: true },
        how: ["A <b>Sphere</b> hole <b>Width 7</b>, <b>Depth 7</b>, <b>Height 5</b> at <b>X 0</b>, <b>Y -25</b>, <b>Z 38</b>."],
        check: (t) => all(t).filter((b) => b.node.kind === "sphere" && b.hole).length >= 3 || rings(t).length > 0,
        demo: { add: "sphere", hole: true, p: { w: 7, d: 7, h: 5 }, at: [0, -25, 38] },
      },
      {
        title: "Group the ghost", tool: "Group", icon: "group", show: { sel: "#bb-group" },
        how: ["<b>Ctrl+A</b>, <b>Group</b>."],
        check: (t) => groupWith(t, ["cylinder", "hemisphere"], 3) || rings(t).length > 0,
        demo: { group: "all" },
      },
      {
        title: "Make it expandable", tool: "Shape it ▾ → Expandable", icon: "shell", show: { sel: "#bb-expand" },
        how: ["Select the ghost. " + MENU("Shape it", "Expandable"), "Under <b>Fidget style</b>, click <b>Classic stretch</b>. Set <b>Rings 4</b>.", "Click <b>Make it expandable</b> and wait a few seconds."],
        when: "The ghost becomes a hollow stack of rings that slide out of each other and stop, all printed in one go: no glue, no assembly.",
        check: (t) => rings(t).length >= 3 || !!document.getElementById("xp-modal"),
        demo: { expand: { preset: "stretch", n: 4 } },
      },
      {
        title: "Watch it stretch", tool: "Simulation: Play", icon: "drive", show: { sel: "#xp-play" },
        how: ["Press <b>▶ Play</b> and watch the rings slide out and back.", "Tick <b>Cut-away view</b> to see the little lips that stop the rings falling apart.", "Want it to twist instead? Click <b>Twist fidget</b> and <b>Make it expandable</b> again."],
        when: "A simulation lets you check how a moving toy works before spending an hour printing it.",
      },
      {
        title: "Add the rings to your design", tool: "Add rings to the design", icon: "group", show: { sel: "#xp-add" },
        how: ["Click <b>Add rings to the design</b>. Your ghost is now four rings (the original is hidden, not deleted)."],
        check: (t) => rings(t).length >= 3,
        demo: { expandAdd: true },
      },
      PRINTSIM,
      saveStep(),
      exportStep(),
    ],
  },
  // ============================================================== 6. Honeycomb lantern (Proficient, art & home)
  {
    id: "b-proj-lantern", mode: "beginner", level: "Proficient", minutes: "25-30", item: "Honeycomb Lantern", ages: "11+", topic: "Art & home",
    title: "Honeycomb lantern",
    blurb: "A tea-light lantern whose round shade is a honeycomb lattice that throws patterns of light on the walls. A base with a pocket for an LED tea light, a ring that holds the shade and a cap with a hanging loop.",
    learn: ["Tube", "Lattice on a curved face", "Cylinder holes", "Torus", "Rotate 90°", "Group"],
    steps: [
      nameStep("Honeycomb Lantern", "Lopez, Maria, Honeycomb Lantern"),
      {
        title: "The shade", tool: "Tube", icon: "tube", show: { tile: "tube" }, anim: "tile",
        how: ["Add a <b>Tube</b>: <b>Width 70</b>, <b>Depth 70</b>, <b>Height 110</b>, Wall <b>3</b> at <b>X 0</b>, <b>Y 0</b>, <b>Z 0</b>."],
        check: (t) => deep(t, "tube", false, (p) => near(p.w, 70, 1) && near(p.h, 110, 2)),
        demo: { add: "tube", p: { w: 70, d: 70, h: 110, wall: 3 }, at: [0, 0, 0] },
      },
      {
        title: "Honeycomb right round", tool: "Shape it ▾ → Lattice", icon: "facePattern", show: { sel: "#bb-lattice" },
        how: ["Select the tube.", MENU("Shape it", "Lattice"), "Click the <b>outside of the tube</b> (its round side). Pick <b>Honeycomb</b>.", TABS, "<b>Cell size 14</b>, <b>Rib width 3</b>, <b>Frame 10</b>. <b>OK</b>."],
        when: "On a curved face the cells follow the surface all the way round with no seam. The frame keeps a solid band top and bottom so the shade stays strong.",
        check: (t) => lattice(t, true),
        demo: { lattice: { kind: "hex", size: 14, gap: 3, border: 10, curved: true } },
      },
      {
        title: "The base", tool: "Cylinder", icon: "cylinder", show: { tile: "cylinder" }, anim: "tile",
        how: ["Add a <b>Cylinder</b> <b>Width 84</b>, <b>Height 8</b> at <b>X 110</b>, <b>Y 0</b>, <b>Z 0</b>."],
        check: (t) => deep(t, "cylinder", false, (p) => near(p.w, 84, 1) && near(p.h, 8, 1)),
        demo: { add: "cylinder", p: { w: 84, d: 84, h: 8 }, at: [110, 0, 0] },
      },
      {
        title: "Pocket for the tea light", tool: "Holes → Cylinder", icon: "holeToggle", show: { tile: "cylinder", hole: true },
        how: ["A <b>Cylinder</b> hole <b>Width 39.5</b>, <b>Height 6</b> at <b>X 110</b>, <b>Y 0</b>, <b>Z 3</b>."],
        when: "LED tea lights are about 38 mm wide: 1.5 mm extra lets it drop in and out.",
        check: (t) => deep(t, "cylinder", true, (p) => near(p.w, 39.5, 0.8)),
        demo: { add: "cylinder", hole: true, p: { w: 39.5, d: 39.5, h: 6 }, at: [110, 0, 3] },
      },
      {
        title: "A ring to hold the shade", tool: "Tube", icon: "tube", show: { tile: "tube" },
        how: ["A <b>Tube</b> <b>Width 78</b>, <b>Height 8</b>, Wall <b>3</b> at <b>X 110</b>, <b>Y 0</b>, <b>Z 8</b>."],
        when: "The ring's inside is 72 mm: the 70 mm shade drops in with 1 mm all round.",
        check: (t) => deep(t, "tube", false, (p) => near(p.w, 78, 1) && near(p.h, 8, 1)),
        demo: { add: "tube", p: { w: 78, d: 78, h: 8, wall: 3 }, at: [110, 0, 8] },
      },
      {
        title: "Group the base", tool: "Group", icon: "group", show: { sel: "#bb-group" },
        how: ["Select the base, its pocket and the ring (drag a box round them), then <b>Group</b>."],
        check: (t) => t.groups().some((g) => t.childKinds(g).includes("tube") && t.countHoles(g) >= 1),
        demo: { group: 3 },
      },
      {
        title: "A cap", tool: "Cone", icon: "cone", show: { tile: "cone" },
        how: ["A <b>Cone</b> <b>Width 80</b>, <b>Height 26</b> at <b>X 220</b>, <b>Y 0</b>, <b>Z 0</b>.", "A <b>Cylinder</b> hole <b>Width 72</b>, <b>Height 6</b> at <b>X 220</b>, <b>Y 0</b>, <b>Z -1</b> underneath, so the cap sits over the shade."],
        check: (t) => deep(t, "cone", false, (p) => near(p.w, 80, 1)) && deep(t, "cylinder", true, (p) => near(p.w, 72, 1)),
        demo: [{ add: "cone", p: { w: 80, d: 80, h: 26 }, at: [220, 0, 0] }, { add: "cylinder", hole: true, p: { w: 72, d: 72, h: 6 }, at: [220, 0, -1] }],
      },
      {
        title: "A hanging loop", tool: "Torus, Rotate 90°", icon: "torus", show: { tile: "torus" },
        how: ["A <b>Torus</b> <b>Width 18</b>, <b>Depth 18</b>, <b>Height 4</b>.", ROT("X") + " It stands up like a ring.", "Position <b>X 220</b>, <b>Y 0</b>, <b>Z 22</b>, poking out of the cap's tip.", "Select the cap, its hole and the loop and <b>Group</b>."],
        check: (t) => t.groups().some((g) => t.childKinds(g).includes("cone") && t.childKinds(g).includes("torus")),
        demo: [{ add: "torus", p: { w: 18, d: 18, h: 4, tube: 4 }, at: [220, 0, 22], rot: ["x"] }, { group: 3 }],
      },
      PRINTSIM,
      saveStep(),
      exportStep(),
    ],
  },
  // ============================================================== 7. Flower pot gift (Easy, nature & gifts)
  {
    id: "b-proj-flowerpot", mode: "beginner", level: "Easy", minutes: "25-30", item: "Flower Pot Gift", ages: "8+", topic: "Nature & gifts",
    title: "Flowers in a pot (a gift)",
    blurb: "Pick two flowers you love in the Flower Studio (there are dozens), colour them, then design the pot they stand in, with holes for the stems and a heart-shaped name tag. A gift that never wilts.",
    learn: ["Flower Studio", "Tube", "Cylinder holes", "Heart", "Text", "Group"],
    steps: [
      nameStep("Flower Pot Gift", "Lopez, Maria, Flower Pot Gift"),
      {
        title: "Your first flower", tool: "Makers ▾ → Flower Studio", icon: "flower", show: { sel: "#bb-flowers" },
        how: [MENU("Makers", "Flower Studio"), "Under <b>One flower</b>, pick a flower (try <b>Tulip</b>, <b>Rose</b> or <b>Sunflower</b>). Pick a colour from the dots or the colour boxes.", "Set <b>Stem 120</b>. Click <b>Add this flower to the design</b>."],
        when: "Every flower is built from real flower shapes: petals in rings, a centre, sepals and leaves.",
        check: (t) => flowers(t).length >= 3,
        demo: { flower: { id: "tulip", stem: 120 } },
      },
      {
        title: "A second flower", tool: "Makers ▾ → Flower Studio", icon: "flower", show: { sel: "#bb-flowers" },
        how: ["Open the <b>Flower Studio</b> again and pick a different flower (<b>Daisy</b> or <b>Cosmos</b>?). Stem <b>100</b>. Add it.", "Move it beside the first one (drag it, or set its <b>X</b>)."],
        check: (t) => new Set(flowers(t).map((b) => b.flower.kind)).size >= 2,
        demo: { flower: { id: "daisy", stem: 100, dx: 50 } },
      },
      {
        title: "The pot", tool: "Tube", icon: "tube", show: { tile: "tube" }, anim: "tile",
        how: ["Add a <b>Tube</b>: <b>Width 70</b>, <b>Height 55</b>, Wall <b>3</b> at <b>X 0</b>, <b>Y 120</b>, <b>Z 0</b>."],
        check: (t) => deep(t, "tube", false, (p) => near(p.w, 70, 1) && near(p.h, 55, 1)),
        demo: { add: "tube", p: { w: 70, d: 70, h: 55, wall: 3 }, at: [0, 120, 0] },
      },
      {
        title: "Fill it with 'soil'", tool: "Cylinder", icon: "cylinder", show: { tile: "cylinder" },
        how: ["A <b>Cylinder</b> <b>Width 66</b>, <b>Height 46</b> at <b>X 0</b>, <b>Y 120</b>, <b>Z 0</b>. Colour it brown."],
        when: "A solid filling holds the stems upright and gives the pot weight so it doesn't tip over.",
        check: (t) => deep(t, "cylinder", false, (p) => near(p.w, 66, 1) && near(p.h, 46, 1.5)),
        demo: { add: "cylinder", p: { w: 66, d: 66, h: 46 }, at: [0, 120, 0] },
      },
      {
        title: "Holes for the stems", tool: "Holes → Cylinder", icon: "holeToggle", show: { tile: "cylinder", hole: true },
        how: ["A <b>Cylinder</b> hole <b>Width 6</b>, <b>Height 25</b> at <b>X -12</b>, <b>Y 120</b>, <b>Z 22</b>.", "Copy it and set <b>X 12</b>. Add a third at <b>X 0</b>, <b>Y 135</b> for a later flower."],
        when: "The stems are about 4.5 mm thick: 6 mm holes let them push in.",
        check: (t) => all(t).filter((b) => b.node.kind === "cylinder" && b.hole && near(b.node.p.w, 6, 0.6)).length >= 2,
        demo: [{ add: "cylinder", hole: true, p: { w: 6, d: 6, h: 25 }, at: [-12, 120, 22] }, { add: "cylinder", hole: true, p: { w: 6, d: 6, h: 25 }, at: [12, 120, 22] }, { add: "cylinder", hole: true, p: { w: 6, d: 6, h: 25 }, at: [0, 135, 22] }],
      },
      {
        title: "Group the pot", tool: "Group", icon: "group", show: { sel: "#bb-group" },
        how: ["Select the pot, the soil and the stem holes (drag a box round them, not the flowers), then <b>Group</b>."],
        check: (t) => t.groups().some((g) => t.childKinds(g).includes("tube") && t.countHoles(g) >= 2),
        demo: { group: 5 },
      },
      {
        title: "A name tag", tool: "Heart and Text", icon: "text", show: { tile: "heart" },
        how: ["A <b>Heart</b> <b>Width 34</b>, <b>Depth 30</b>, <b>Height 3</b> at <b>X 60</b>, <b>Y 160</b>, <b>Z 0</b>.", "<b>Text</b> with a name (<b>MOM</b>, <b>DAD</b>, <b>GRAN</b>…): Size <b>8</b>, Height <b>1.5</b> at <b>X 60</b>, <b>Y 162</b>, <b>Z 3</b>. Colour it.", "Group the heart and its text. Glue the tag to the pot after printing."],
        check: (t) => t.groups().some((g) => t.childKinds(g).includes("heart") && t.childKinds(g).includes("text")),
        demo: [{ add: "heart", p: { w: 34, d: 30, h: 3 }, at: [60, 160, 0] }, { add: "text", p: { text: "MOM", size: 8, h: 1.5 }, at: [60, 162, 3] }, { group: 2 }],
      },
      saveStep(),
      exportStep(),
    ],
  },
  // ============================================================== 8. Robot bouquet (Advanced, robots & nature)
  {
    id: "b-proj-robobouquet", mode: "beginner", level: "Advanced", minutes: "30-35", item: "Robot Bouquet", ages: "13+", topic: "Robots & nature",
    title: "Robot bouquet with moving petals",
    blurb: "A mechanical bouquet whose petals swing on print-in-place hinges, a collapsible vase that twists up from flat with the Expandable tool, and a honeycomb lattice display plate. Three of the newest tools in one project.",
    learn: ["Flower Studio (mechanical, hinged)", "Expandable (twist)", "Lattice", "Cylinder", "Text", "3D Print Sim"],
    steps: [
      nameStep("Robot Bouquet", "Lopez, Maria, Robot Bouquet"),
      {
        title: "Mechanical flowers", tool: "Makers ▾ → Flower Studio", icon: "flower", show: { sel: "#bb-flowers" },
        how: [MENU("Makers", "Flower Studio"), "Click <b>Arrangement</b>, then the idea <b>Robot garden</b>.", "Set <b>Petals</b> to <b>Hinged (they swing)</b>. Press <b>▶ Play bloom</b>: the petals open and close on their pins.", "Click <b>Add the arrangement to the design</b>."],
        when: "Hinged petals print in place: each petal has a knuckle round a pin, with 0.35 mm of air, so it swings straight off the printer.",
        check: (t) => flowers(t).some((b) => b.flower.style === "mech" && b.flower.petals === "hinged"),
        demo: { arrangement: { preset: 5, petals: "hinged" } },
      },
      {
        title: "Count the hinges", tool: "Flower Studio", icon: "flower",
        how: ["Look at the message under the Bloom slider when you build: it says how many petals got hinges.", "Flowers with up to 12 big petals (tulip, lily, cosmos, poppy) get hinges; dense ones like daisies keep fixed petals."],
        when: "Good designs tell you their limits. Hinges need room round the hub for the pin's ears.",
      },
      {
        title: "A vase blank", tool: "Cylinder", icon: "cylinder", show: { tile: "cylinder" },
        how: ["Add a <b>Cylinder</b> <b>Width 60</b>, <b>Height 80</b> at <b>X 200</b>, <b>Y 0</b>, <b>Z 0</b>."],
        check: (t) => deep(t, "cylinder", false, (p) => near(p.w, 60, 1) && near(p.h, 80, 1.5)) || rings(t).length > 0,
        demo: { add: "cylinder", p: { w: 60, d: 60, h: 80 }, at: [200, 0, 0] },
      },
      {
        title: "Make it twist up", tool: "Shape it ▾ → Expandable", icon: "shell", show: { sel: "#bb-expand" },
        how: ["Select the cylinder. " + MENU("Shape it", "Expandable"), "Click <b>Twist fidget</b>, set <b>Rings 3</b>, <b>Bottom: Closed</b>.", "<b>Make it expandable</b>, press <b>Play</b> to watch it screw up, then <b>Add rings to the design</b>."],
        when: "The rings' tabs run in spiral grooves: twist the top and the vase rises. It prints squashed flat and stretches tall on your desk.",
        check: (t) => rings(t).some((b) => b.expand.motion === "twist"),
        demo: { expand: { preset: "twist", n: 3, bottom: "closed", add: true } },
      },
      {
        title: "A lattice display plate", tool: "Box, Shape it ▾ → Lattice", icon: "facePattern", show: { sel: "#bb-lattice" },
        how: ["A <b>Box</b> <b>Width 140</b>, <b>Depth 100</b>, <b>Height 5</b> at <b>X 200</b>, <b>Y 120</b>, <b>Z 0</b>.", MENU("Shape it", "Lattice") + " Click its top face. <b>Honeycomb</b>, <b>Cell 12</b>, <b>Rib 2.5</b>, <b>Frame 10</b>. <b>OK</b>."],
        when: "A lattice keeps the plate stiff with far less plastic, and it looks like a robot's circuit board.",
        check: (t) => lattice(t, false),
        demo: [{ add: "box", p: { w: 140, d: 100, h: 5 }, at: [200, 120, 0] }, { lattice: { kind: "hex", size: 12, gap: 2.5, border: 10, curved: false } }],
      },
      {
        title: "A name plate", tool: "Text", icon: "text", show: { tile: "text" },
        how: ["<b>Text</b> with your bouquet's name (<b>ROBO GARDEN</b>?): Size <b>10</b>, Height <b>4</b> at <b>X 200</b>, <b>Y 190</b>, <b>Z 0</b>."],
        check: (t) => t.prim("text").some((b) => near(b.node.p.h, 4, 1)),
        demo: { add: "text", p: { text: "ROBO GARDEN", size: 10, h: 4 }, at: [200, 190, 0] },
      },
      PRINTSIM,
      saveStep(),
      exportStep(),
    ],
  },
  // ============================================================== 9. Basketball catapult (Proficient, games & machines)
  {
    id: "b-proj-catapult", mode: "beginner", level: "Proficient", minutes: "30-35", item: "Basketball Catapult", ages: "10+", topic: "Games & machines",
    title: "Mini basketball catapult",
    blurb: "A desk game: a catapult arm on a pin flicks a ball into a hoop with a backboard. Lever, pivot and launch angle, all in parts that fit together.",
    learn: ["Box", "Holes that fit", "Rotate 90°", "Sphere hole (cup)", "Tube", "Capsule", "Group"],
    steps: [
      nameStep("Basketball Catapult", "Lopez, Maria, Basketball Catapult"),
      {
        title: "Base", tool: "Box", icon: "box", show: { tile: "box" },
        how: ["A <b>Box</b> <b>Width 120</b>, <b>Depth 50</b>, <b>Height 6</b> at <b>X 0</b>, <b>Y 0</b>, <b>Z 0</b>."],
        check: (t) => deep(t, "box", false, (p) => near(p.w, 120) && near(p.d, 50) && near(p.h, 6)),
        demo: { add: "box", p: { w: 120, d: 50, h: 6 }, at: [0, 0, 0] },
      },
      {
        title: "Two uprights", tool: "Box", icon: "box", show: { tile: "box" },
        how: ["A <b>Box</b> <b>Width 10</b>, <b>Depth 6</b>, <b>Height 32</b> at <b>X -30</b>, <b>Y -11</b>, <b>Z 6</b>.", "Copy it to <b>Y 11</b>. The arm will sit in the 16 mm gap between them."],
        check: (t) => all(t).filter((b) => b.node.kind === "box" && !b.hole && near(b.node.p.h, 32, 1)).length >= 2,
        demo: [{ add: "box", p: { w: 10, d: 6, h: 32 }, at: [-30, -11, 6] }, { add: "box", p: { w: 10, d: 6, h: 32 }, at: [-30, 11, 6] }],
      },
      {
        title: "The pivot hole", tool: "Holes → Cylinder, Rotate 90°", icon: "holeToggle", show: { tile: "cylinder", hole: true },
        how: ["A <b>Cylinder</b> hole <b>Width 5.4</b>, <b>Depth 5.4</b>, <b>Height 40</b>. " + ROT("X") + " It lies along Y.", "Position <b>X -30</b>, <b>Y 0</b>, <b>Z 30</b>: through both uprights."],
        when: "The pin is 5 mm: 5.4 mm holes let the arm swing freely.",
        check: (t) => deep(t, "cylinder", true, (p) => near(p.w, 5.4, 0.4)),
        demo: { add: "cylinder", hole: true, p: { w: 5.4, d: 5.4, h: 40 }, at: [-30, 0, 30], rot: ["x"] },
      },
      {
        title: "Group the base", tool: "Group", icon: "group", show: { sel: "#bb-group" },
        how: ["<b>Ctrl+A</b>, <b>Group</b>."],
        check: (t) => t.groups().some((g) => t.countHoles(g) >= 1 && near((t.box(g.id) || { size: { x: 0 } }).size.x, 120, 3)),
        demo: { group: "all" },
      },
      {
        title: "The arm", tool: "Box, Cylinder", icon: "box", show: { tile: "box" },
        how: ["A <b>Box</b> <b>Width 90</b>, <b>Depth 14</b>, <b>Height 6</b> at <b>X 30</b>, <b>Y 70</b>, <b>Z 0</b>.", "A cup at one end: <b>Cylinder</b> <b>Width 22</b>, <b>Height 10</b> at <b>X 70</b>, <b>Y 70</b>, <b>Z 0</b>."],
        check: (t) => deep(t, "box", false, (p) => near(p.w, 90, 1) && near(p.d, 14, 1)) && deep(t, "cylinder", false, (p) => near(p.w, 22, 1) && near(p.h, 10, 1)),
        demo: [{ add: "box", p: { w: 90, d: 14, h: 6 }, at: [30, 70, 0] }, { add: "cylinder", p: { w: 22, d: 22, h: 10 }, at: [70, 70, 0] }],
      },
      {
        title: "Scoop and pivot hole", tool: "Holes → Sphere, Cylinder", icon: "holeToggle", show: { tile: "sphere", hole: true },
        how: ["A <b>Sphere</b> hole <b>Width 16</b> at <b>X 70</b>, <b>Y 70</b>, <b>Z 6</b>: a scoop for the ball.", "A <b>Cylinder</b> hole <b>Width 5.4</b>, <b>Height 20</b>, " + ROT("X") + " Position <b>X -10</b>, <b>Y 70</b>, <b>Z 3</b>: the arm's pivot hole.", "Select the arm parts and <b>Group</b>."],
        check: (t) => t.groups().some((g) => t.childKinds(g).includes("sphere") && t.countHoles(g) >= 2),
        demo: [{ add: "sphere", hole: true, p: { w: 16, d: 16, h: 16 }, at: [70, 70, 6] }, { add: "cylinder", hole: true, p: { w: 5.4, d: 5.4, h: 20 }, at: [-10, 70, 3], rot: ["x"] }, { group: 4 }],
      },
      {
        title: "Pin and balls", tool: "Capsule, Sphere", icon: "capsule", show: { tile: "capsule" },
        how: ["A pin: <b>Capsule</b> <b>Width 36</b>, <b>Depth 5</b>, <b>Height 5</b> at <b>X 0</b>, <b>Y 110</b>, <b>Z 0</b>.", "A ball: <b>Sphere</b> <b>Width 13</b> at <b>X 40</b>, <b>Y 110</b>, <b>Z 0</b>, then pattern it: <b>Along X</b>, <b>Count 3</b>, <b>Spacing 18</b>."],
        check: (t) => deep(t, "capsule", false, (p) => near(p.w, 36, 2) && near(p.d, 5, 0.5)) && all(t).filter((b) => b.node.kind === "sphere" && !b.hole && near(b.node.p.w, 13, 1)).length >= 3,
        demo: [{ add: "capsule", p: { w: 36, d: 5, h: 5 }, at: [0, 110, 0] }, { add: "sphere", p: { w: 13, d: 13, h: 13 }, at: [40, 110, 0] }, { row: 3, dx: 18 }],
      },
      {
        title: "The hoop", tool: "Box, Tube", icon: "tube", show: { tile: "tube" },
        how: ["Foot: <b>Box</b> <b>Width 40</b>, <b>Depth 40</b>, <b>Height 4</b> at <b>X 160</b>, <b>Y 0</b>, <b>Z 0</b>.", "Post: <b>Box</b> <b>Width 6</b>, <b>Depth 6</b>, <b>Height 110</b> at <b>X 160</b>, <b>Y 14</b>, <b>Z 4</b>.", "Backboard: <b>Box</b> <b>Width 44</b>, <b>Depth 4</b>, <b>Height 32</b> at <b>X 160</b>, <b>Y 10</b>, <b>Z 84</b>.", "Hoop: <b>Tube</b> <b>Width 30</b>, <b>Height 3</b>, Wall <b>2.5</b> at <b>X 160</b>, <b>Y -8</b>, <b>Z 90</b>. Select the four and <b>Group</b>."],
        when: "The 30 mm hoop is roomy for a 13 mm ball: hard enough to be fun, easy enough to score.",
        check: (t) => groupWith(t, ["tube", "box"], 0),
        demo: [{ add: "box", p: { w: 40, d: 40, h: 4 }, at: [160, 0, 0] }, { add: "box", p: { w: 6, d: 6, h: 110 }, at: [160, 14, 4] }, { add: "box", p: { w: 44, d: 4, h: 32 }, at: [160, 10, 84] }, { add: "tube", p: { w: 30, d: 30, h: 3, wall: 2.5 }, at: [160, -8, 90] }, { group: 4 }],
      },
      PRINTSIM,
      saveStep(),
      exportStep(),
    ],
  },
];
