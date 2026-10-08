"use client";

import { useRef, useState } from "react";
import { clsx } from "clsx";
import { blockSize } from "@/lib/sim-engine/scenarios/subnettingDesign";
import { lastOctet, subnetCalc } from "@/lib/sim-engine/scenarios/subnettingLab";
import { AddressGrid, Legend, type SnapOverlay } from "./SubnetGrid";
import { BitBar, Btn, ChainStrip, HOST, Idea, Lead, NET, Now, Predict, PrefixSlider, Readout, Scene, TryList, bits8, blank, ip, maskOctet, paint, tile, useSeen, useStepper } from "./SubnetKit";

/**
 * LEARN — three explorable pictures, no questions required (the basics come first, in SubnetStart):
 *   1 · Move the line      the prefix slider: borrowing a host bit doubles the blocks and halves them (one chain)
 *   2 · Where blocks start probe any address: clear its host bits and you land on the start of its block
 *   3 · Inside a block     count through a block: host bits all 0 = network, all 1 = broadcast, the rest devices
 * Every number shown comes from the lab model (subnetCalc) or plain bit display; nothing is graded or recorded.
 */

const BOARD_LABEL = "Address board 10.44.0.0/24: 256 addresses, 16 per row";
const pow = (n: number) => 2 ** n;

// =============================================================================================================
// 2 · Move the line
// =============================================================================================================
const STORY: Record<number, { title: string; body: string }> = {
  24: { title: "/24: ONE network of 256 addresses. This is “before subnetting”.", body: "The line sits after 24 bits, so all 8 bits of the last number are host bits: 2⁸ = 256 addresses, one network. Now drag the line one step right." },
  25: { title: "/25: you borrowed 1 host bit, giving 2 subnets of 128.", body: "The borrowed bit (worth 128) is 0 for .0–.127 and 1 for .128–.255, so it cuts the board in two: 10.44.0.0/25 and 10.44.0.128/25. No address was created: the same 256, divided." },
  26: { title: "/26: 2 borrowed bits, giving 4 subnets of 64.", body: "Two borrowed bits can be 00, 01, 10 or 11: four combinations, so four blocks. Each /25 half split in two." },
  27: { title: "/27: 3 borrowed bits, giving 8 subnets of 32.", body: "2³ = 8 combinations of the borrowed bits, so 8 blocks. Only 5 host bits remain, 2⁵ = 32 addresses each: two rows of this board." },
  28: { title: "/28: 4 borrowed bits, giving 16 subnets of 16.", body: "Exactly one row each. No accident: the top 4 bits pick the row, and now they are exactly the borrowed bits." },
  29: { title: "/29: 5 borrowed bits, giving 32 subnets of 8.", body: "3 host bits left: 2³ = 8 addresses. Two blocks per row." },
  30: { title: "/30: 6 borrowed bits, giving 64 subnets of 4.", body: "2 host bits left: 4 addresses, only 2 usable (see “Inside a block”). Perfect for a link between two routers." },
};

export function LearnMoveTheLine() {
  const [prefix, setPrefixState] = useState(24);
  const [prev, setPrev] = useState<number | undefined>(undefined);
  const current = useRef(24);
  const setPrefixRaw = (p: number) => {
    setPrev(current.current);
    current.current = p;
    setPrefixState(p);
  };
  const [focus, setFocus] = useState<number | undefined>(undefined);
  const [seen, mark] = useSeen();
  const [play, stop, playing] = useStepper();
  const setPrefix = (p: number) => {
    setPrefixRaw(p);
    mark(`p${p}`);
  };
  const n = prefix - 24;
  const size = blockSize(prefix);
  const cells = blank();
  tile(cells, prefix, { tags: true });
  const fb = focus !== undefined ? Math.floor(focus / size) : undefined;
  if (focus !== undefined) {
    const s = fb! * size;
    paint(cells, s, size, () => ({ groupColor: "#ffffff" }));
    cells[focus] = { ...cells[focus], ring: "info" };
  }
  const point = (o: number | undefined) => {
    setFocus(o);
    if (o !== undefined && prefix === 27) mark("block");
  };
  const blocks = 256 / size;
  const overlays: SnapOverlay[] =
    blocks <= 8
      ? Array.from({ length: blocks }, (_, k) => ({ key: `b${prefix}-${k}`, first: k * size, size, color: "rgba(255,255,255,0.75)", from: 0, labelRight: true, label: blocks === 1 ? "10.44.0.0/24 · ONE network · 256 addresses" : blocks <= 4 ? `10.44.0.${k * size}/${prefix} · ${size} addresses` : `.${k * size}/${prefix}` }))
      : [];
  const animate = () => {
    mark("play");
    play([24, 25, 26, 27, 28, 29, 30], 1300, (p) => setPrefixRaw(p));
  };

  return (
    <Scene
      board={<AddressGrid cells={cells} onTap={point} onHover={point} overlays={overlays} label={BOARD_LABEL} footer={<Legend items={[{ color: "rgba(34,211,238,0.62)", label: "first address of each block" }]} />} />}
      hint={focus !== undefined ? `10.44.0.${focus} is in block ${fb} of ${pow(n)}` : "Move the slider · point at a square to find its block"}
      side={
        <>
          <Lead kicker="Explore · 5 of 7" title="Move the line: how subnetting divides">
            <p>Subnetting <b className="text-pv-text">borrows host bits</b> and gives them to the network side. Move the line right one step at a time and watch all four numbers change together.</p>
          </Lead>
          <PrefixSlider value={prefix} onChange={setPrefix} />
          <div className="flex flex-wrap gap-2">
            {playing ? (
              <Btn tone="quiet" onClick={stop}>
                Pause
              </Btn>
            ) : (
              <Btn tone="quiet" onClick={animate}>
                ▶ Animate /24 → /30
              </Btn>
            )}
          </div>
          <ChainStrip prefix={prefix} prev={prev} />
          <BitBar octet={focus} prefix={prefix} showMask flashBorrowed={prev !== undefined && prefix > prev} />
          <Now k={`p${prefix}`} title={STORY[prefix].title}>
            <p>{STORY[prefix].body}</p>
            {focus !== undefined && n > 0 && (
              <p>
                <span className="pv-mono text-pv-text">.{focus}</span>: its network bits <b className="pv-mono" style={{ color: NET }}>{bits8(focus).slice(0, n)}</b> = block {fb}, which runs <span className="pv-mono text-pv-text">.{fb! * size}–.{fb! * size + size - 1}</span>.
              </p>
            )}
          </Now>
          <Idea>
            <p>Move the line right: one bit leaves the host side and joins the network side. That <b>doubles the number of subnet blocks</b> and <b>halves the size of each block</b>.</p>
            <p className="text-pv-text-muted">
              Block size = 2^(host bits). Look at the bit bar: the block size is the value of the last network bit (highlighted above the bits), and the mask&apos;s last number is 256 minus it.
            </p>
          </Idea>
          <Ladder prefix={prefix} onPick={setPrefix} />
          <Predict
            q="Before you slide there: how many blocks will /28 make?"
            options={["8", "12", "16", "28"]}
            answer={2}
            onTest={() => setPrefix(28)}
            explain={<p>4 network bits → 2⁴ = 16 blocks of 16. On this board that&apos;s exactly one row each.</p>}
          />
          <TryList
            items={[
              { text: <>Slide to <b>/25</b> and see the two halves.</>, done: !!seen.p25 },
              { text: <>Slide to <b>/26</b>: each half splits again.</>, done: !!seen.p26 },
              { text: <>At <b>/27</b>, point at any square and read its block number from the purple bits.</>, done: !!seen.block },
              { text: <>Play the whole animation /24 → /30.</>, done: !!seen.play },
            ]}
          />
        </>
      }
    />
  );
}

function Ladder({ prefix, onPick }: { prefix: number; onPick: (p: number) => void }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-pv-border">
      <table className="w-full text-left text-[13px]">
        <caption className="bg-pv-bg-elevated/50 px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-pv-text-faint">The whole pattern</caption>
        <thead className="text-[11.5px] text-pv-text-faint">
          <tr>
            <th className="px-3 py-1 font-semibold">Prefix</th>
            <th className="px-2 py-1 font-semibold">Mask</th>
            <th className="px-2 py-1 font-semibold">Blocks</th>
            <th className="px-2 py-1 font-semibold">Size</th>
            <th className="px-2 py-1 font-semibold">Devices</th>
          </tr>
        </thead>
        <tbody className="pv-mono">
          {[24, 25, 26, 27, 28, 29, 30].map((p) => (
            <tr key={p} onClick={() => onPick(p)} className={clsx("cursor-pointer border-t border-pv-border/60 transition-colors", p === prefix ? "bg-pv-cyan/15 text-pv-text" : "text-pv-text-muted hover:bg-white/[0.03]")}>
              <td className="px-3 py-1 font-bold">/{p}</td>
              <td className="px-2 py-1">.{maskOctet(p)}</td>
              <td className="px-2 py-1">{pow(p - 24)}</td>
              <td className="px-2 py-1">{blockSize(p)}</td>
              <td className="px-2 py-1">{blockSize(p) - 2}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// =============================================================================================================
// 3 · Where blocks start
// =============================================================================================================
export function LearnWhereBlocksStart() {
  const [prefix, setPrefixRaw] = useState(27);
  const [pinned, setPinned] = useState<number | undefined>(200);
  const [hover, setHover] = useState<number | undefined>(undefined);
  const [tapSeq, setTapSeq] = useState(0);
  const [seen, mark] = useSeen();
  const probe = hover ?? pinned;
  const size = blockSize(prefix);
  const setPrefix = (p: number) => {
    setPrefixRaw(p);
    if (pinned !== undefined && p !== 27) mark("resize");
  };
  const pin = (o: number) => {
    setPinned(o);
    setTapSeq((s) => s + 1);
    if (prefix === 27 && o === 192) mark("good");
    if (prefix === 27 && o % 32 !== 0) mark("bad");
  };

  const cells = blank();
  tile(cells, prefix);
  let overlays: SnapOverlay[] = [];
  let start: number | undefined;
  if (probe !== undefined) {
    start = probe & maskOctet(prefix);
    paint(cells, start, size, () => ({ groupColor: "#ffffff" }));
    cells[start] = { ...cells[start], tag: "S" };
    cells[probe] = { ...cells[probe], ring: probe === start ? "ok" : "bad" };
    if (pinned !== undefined && hover === undefined && probe !== start) overlays = [{ key: `${tapSeq}-${prefix}-${probe}`, first: start, size, color: "#ffffff", from: probe - start, label: `block starts .${start}` }];
  }
  const isStart = probe !== undefined && probe === start;
  const starts = Array.from({ length: 256 / size }, (_, i) => i * size);

  return (
    <Scene
      board={<AddressGrid cells={cells} onTap={pin} onHover={setHover} overlays={overlays} label={BOARD_LABEL} footer={<Legend items={[{ color: "rgba(34,211,238,0.62)", label: "a block start" }]} />} />}
      hint={probe !== undefined ? `Probing 10.44.0.${probe}${pinned === probe ? " (pinned)" : ""}` : "Tap a square to probe it"}
      side={
        <>
          <Lead kicker="Explore · 6 of 7" title="Why a subnet can start here, but not there">
            <p>Inside one block the network bits never change, and the host bits count up from all 0 to all 1. So <b className="text-pv-text">a block always begins where the host bits are all 0</b>.</p>
            <p>Tap any square: the bottom row of the bit bar clears its host bits, and that&apos;s the start of its block.</p>
          </Lead>
          <PrefixSlider value={prefix} onChange={setPrefix} min={25} />
          <BitBar
            octet={probe}
            prefix={prefix}
            clear
            caption={probe !== undefined && <p>Bottom row: the same bits with every host bit set to 0 (that&apos;s “address AND mask”). The result is the block&apos;s first address.</p>}
          />
          {probe === undefined ? (
            <Now k="none" title="Tap a square to probe it." />
          ) : isStart ? (
            <Now k={`s${probe}-${prefix}`} tone="ok" title={`✓ .${probe} can start a /${prefix} block.`}>
              <p>
                Its {32 - prefix} host bits are already all <b style={{ color: HOST }}>0</b>, so clearing them changes nothing. .{probe} = {probe / size} × {size}.
              </p>
            </Now>
          ) : (
            <Now k={`n${probe}-${prefix}`} tone="warn" title={`.${probe} can't start a /${prefix} block. It's inside the .${start} block.`}>
              <p>
                Some of its {32 - prefix} host bits are 1. Clear them and you get <b className="pv-mono text-pv-text">.{start}</b>, the start (S) of the block .{probe} belongs to: .{start}–.{start! + size - 1}.
              </p>
            </Now>
          )}
          <div className="rounded-2xl border border-pv-border bg-pv-bg-elevated/30 p-3">
            <p className="text-[13px] text-pv-text-muted">
              Every /{prefix} start, i.e. every place where the host bits are all 0. Those are the multiples of <b className="text-pv-text">{size}</b>:
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {starts.length <= 16 ? (
                starts.map((s) => (
                  <button key={s} type="button" onClick={() => pin(s)} className={clsx("rounded-md border px-1.5 py-0.5 pv-mono text-[12.5px]", s === start ? "border-pv-cyan bg-pv-cyan/15 text-pv-text" : "border-pv-border text-pv-text-muted hover:text-pv-text")}>
                    .{s}
                  </button>
                ))
              ) : (
                <span className="pv-mono text-[12.5px] text-pv-text-muted">
                  .0 · .{size} · .{size * 2} · .{size * 3} … every {size} ({starts.length} starts)
                </span>
              )}
            </div>
          </div>
          <Idea>
            <p>A block starts where all its host bits are 0. With h host bits that happens every 2^h addresses, so <b>starts are the multiples of the block size</b>.</p>
            <p className="text-pv-text-muted">Clearing the host bits (address AND mask) finds the start of the block that any address lives in. Devices do exactly this.</p>
          </Idea>
          <Predict
            q="Can .96 start a /26 block?"
            options={["Yes", "No"]}
            answer={1}
            onTest={() => {
              setPrefixRaw(26);
              pin(96);
            }}
            explain={<p>96 = 64 + 32. At /26 the 32 bit is a host bit, so the host bits aren&apos;t all 0: .96 sits inside the .64 block. At /27 it <i>would</i> be a start.</p>}
          />
          <TryList
            items={[
              { text: <>At /27, tap <b>.192</b>: a real start.</>, done: !!seen.good },
              { text: <>At /27, tap a square that isn&apos;t lit, like <b>.200</b>.</>, done: !!seen.bad },
              { text: <>Keep a square pinned and move the slider. Its block grows and shrinks around it, but always starts on a multiple of its size.</>, done: !!seen.resize },
            ]}
          />
        </>
      }
    />
  );
}

// =============================================================================================================
// 4 · Inside a block
// =============================================================================================================
export function LearnInsideABlock() {
  const [prefix, setPrefixRaw] = useState(27);
  const [sel, setSel] = useState(192);
  const [scrub, setScrub] = useState<number | undefined>(undefined);
  const [seen, mark] = useSeen();
  const [play, stop, playing] = useStepper();
  const size = blockSize(prefix);
  const setPrefix = (p: number) => {
    stop();
    setPrefixRaw(p);
    setSel((s) => s & maskOctet(p));
    setScrub(undefined);
    if (p === 30) mark("p30");
  };
  const c = subnetCalc(ip(sel), prefix);
  const net = lastOctet(c.network);
  const bc = lastOctet(c.broadcast);

  const cells = blank();
  tile(cells, prefix, { lit: false });
  for (let o = 0; o < 256; o++) if (o < net || o > bc) cells[o] = { ...cells[o], dim: true };
  paint(cells, net, size, () => ({ groupColor: "#ffffff", fill: "rgba(34,211,238,0.38)" }));

  // The two special squares are discovered, not announced: they stay "?" until the learner has looked at both ends.
  const revealed = (!!seen.n && !!seen.b) || !!seen.counted;
  const zoom = blank();
  paint(zoom, net, size, (i) =>
    i === 0 ? (revealed ? { fill: "rgba(167,139,250,0.55)", tag: "N" } : { fill: "rgba(52,211,153,0.30)", tag: "?" }) : i === size - 1 ? (revealed ? { fill: "rgba(251,191,36,0.55)", tag: "B" } : { fill: "rgba(52,211,153,0.30)", tag: "?" }) : { fill: "rgba(52,211,153,0.30)" },
  );
  if (scrub !== undefined) zoom[scrub] = { ...zoom[scrub], ring: "info" };
  const look = (o: number | undefined) => {
    setScrub(o);
    if (o === net) mark("n");
    if (o === bc) mark("b");
  };
  const countThrough = () => {
    mark("count");
    play(
      Array.from({ length: size }, (_, i) => net + i),
      Math.max(40, Math.round(3200 / size)),
      (o) => look(o),
      () => mark("counted"),
    );
  };
  const role = (o: number | undefined) => (o === undefined ? undefined : o === net ? "network" : o === bc ? "broadcast" : "usable");
  const r = role(scrub);
  const shown = scrub ?? net;
  const hb = bits8(shown).slice(prefix - 24);

  return (
    <Scene
      board={
        <AddressGrid
          cells={cells}
          onTap={(o) => {
            setSel(o & maskOctet(prefix));
            setScrub(undefined);
            if ((o & maskOctet(prefix)) !== 192) mark("other");
          }}
          label={BOARD_LABEL}
        />
      }
      hint="Tap any block on the board to look inside it"
      side={
        <>
          <Lead kicker="Explore · 7 of 7" title="Inside one block: network, devices, broadcast">
            <p>Inside a block the host bits count from all 0 to all 1. Two of those values are special. Count through the block and watch the host bits at the very first and very last square.</p>
          </Lead>
          <PrefixSlider value={prefix} onChange={setPrefix} min={25} />
          <div className="rounded-2xl border border-pv-border bg-pv-bg-elevated/30 p-2.5">
            <p className="mb-1.5 text-[12.5px] text-pv-text-muted">
              Zoom: <span className="pv-mono text-pv-text">10.44.0.{net}/{prefix}</span> ({size} addresses)
            </p>
            <AddressGrid
              key={`${net}-${prefix}`}
              cells={zoom}
              start={net}
              count={size}
              cols={Math.min(16, size >= 64 ? 16 : size >= 8 ? 8 : size)}
              size={size <= 32 ? "zoom" : "board"}
              numbers="all"
              onHover={(o) => !playing && look(o)}
              onTap={look}
              label={`Zoom of block 10.44.0.${net}/${prefix}`}
              footer={<Legend items={[{ color: "rgba(167,139,250,0.75)", label: "N network" }, { color: "rgba(52,211,153,0.5)", label: "devices" }, { color: "rgba(251,191,36,0.75)", label: "B broadcast" }]} />}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {playing ? (
              <Btn tone="quiet" onClick={stop}>
                Pause
              </Btn>
            ) : (
              <Btn onClick={countThrough}>▶ Count through this block</Btn>
            )}
          </div>
          <BitBar octet={shown} prefix={prefix} />
          {scrub === undefined ? (
            <Now k={`i${net}-${prefix}`} title={revealed ? "Point at any square in the zoom." : "Two squares (?) have a special job."}>
              <p>{revealed ? "First square: host bits all 0. Last square: host bits all 1. Everything between is for devices." : "Count through the block, or point at the first and last squares, and compare their host bits."}</p>
            </Now>
          ) : r === "network" ? (
            <Now k={`n${scrub}`} tone="info" title={`.${net}: host bits ${hb}, all zeros. The network address.`}>
              <p>
                With every host bit 0, this value means the block itself: its name in a plan and in routing tables (10.44.0.{net}/{prefix}). It is never given to a device.
              </p>
            </Now>
          ) : r === "broadcast" ? (
            <Now k={`b${scrub}`} tone="warn" title={`.${bc}: host bits ${hb}, all ones. The broadcast address.`}>
              <p>Every host bit 1 means “all devices in this block”. A packet sent here reaches all of them, so it can&apos;t belong to just one device.</p>
            </Now>
          ) : (
            <Now k={`u${scrub}`} title={`.${scrub}: host bits ${hb}, a device address.`}>
              <p>Anything between all-0 and all-1 can be given to a device. Usually the router takes the first one (.{net + 1}).</p>
            </Now>
          )}
          <Readout
            items={[
              { k: "Network", v: `.${net}` },
              { k: "Devices", v: `.${lastOctet(c.first)}–.${lastOctet(c.last)}`, sub: `${c.usable} usable` },
              { k: "Broadcast", v: `.${bc}` },
            ]}
          />
          <Idea>
            <p>
              Every block gives up two addresses: <b>network</b> (host bits all 0) and <b>broadcast</b> (host bits all 1). So a block holds <b>2^h − 2 devices</b>.
            </p>
            <p className="text-pv-text-muted">That “−2” is why a network that needs 31 devices doesn&apos;t fit in a 32-address block: a /27 has only 30 device addresses.</p>
          </Idea>
          <details className="rounded-2xl border border-pv-border px-3 py-2">
            <summary className="cursor-pointer text-[13.5px] font-semibold text-pv-cyan-soft outline-none">Special cases: /31 and /32</summary>
            <div className="mt-1.5 space-y-1 text-[13.5px] leading-snug text-pv-text-muted">
              <p>
                The −2 rule is for <b className="text-pv-text">ordinary LAN subnets</b>, where a network and a broadcast address are needed. Two prefixes are different on purpose:
              </p>
              <p>
                <b className="pv-mono text-pv-text">/31</b> = 1 host bit = 2 addresses. On a point-to-point link between two routers there is nobody else to broadcast to, so RFC 3021 lets both addresses be used: 2 usable, not 0.
              </p>
              <p>
                <b className="pv-mono text-pv-text">/32</b> = 0 host bits = exactly 1 address: one device (a loopback, or a host route), not a network of devices.
              </p>
              <p className="text-pv-text-faint">This lab plans ordinary LANs and uses /30 for router links, so it always uses 2^h − 2.</p>
            </div>
          </details>
          <Predict
            q="How many devices fit in a /30 (4 addresses)?"
            options={["4", "2", "1"]}
            answer={1}
            onTest={() => setPrefix(30)}
            explain={<p>4 addresses − network − broadcast = 2: exactly two routers on a link. That&apos;s why the R1–R2 transit link uses a /30.</p>}
          />
          <TryList
            items={[
              { text: <>Find the two special squares: look at the first and last host bits.</>, done: revealed },
              { text: <>Tap a different block on the big board.</>, done: !!seen.other },
              { text: <>Shrink to <b>/30</b>: how many devices are left?</>, done: !!seen.p30 },
            ]}
          />
        </>
      }
    />
  );
}
