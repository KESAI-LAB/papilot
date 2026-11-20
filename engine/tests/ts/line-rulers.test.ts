import { expect, it } from "vitest";
import { which } from "../../src/core/process.ts";
import { Fixture } from "./helpers.ts";

const tex = Boolean(which("latexmk") && which("pdflatex"));
const original = "The storage component keeps an immutable copy of every completed measurement.";
const right = "The aggregator combines measurements only when their experimental conditions agree.";
const addition = String.raw`We additionally preserve the \emph{original observation order} when a delayed worker publishes its result.`;
const prose = [
  "The collector records observations before the evaluator starts its analysis. Each observation carries a stable identifier so that later revisions can be traced to their original source. Missing observations remain visible in the report and are not replaced by values from a neighboring trial.",
  `${original} Readers obtain a consistent snapshot while writers prepare the next version in a separate directory. This arrangement allows the experiment to continue without changing the evidence used by an earlier result.`,
  "The scheduler assigns pending jobs to workers according to their declared resource requirements. A worker checks the input version before it starts and records the version again when it publishes a result. Jobs that lose their connection can be resumed because the completed steps have durable identifiers.",
  "The validator checks the shape of the submitted data before interpreting individual values. Unexpected fields are reported alongside the relevant observation so that the author can correct the source. A successful validation confirms consistency with the declared format but does not establish the scientific interpretation.",
  `${right} The report retains the contribution of each trial and presents the number of observations used in every estimate. This makes an unexpected result easier to inspect without requiring the entire experiment to be repeated. The measured limit is 25.`,
  "The recovery procedure starts from the last complete record rather than from an intermediate file. Partial outputs are retained for inspection and do not replace the published measurements. The operator can therefore distinguish a failed computation from a completed computation with an unusual outcome.",
];
function ruler(x: number, first: number) {
  return Array.from({ length: 58 }, (_, i) => String.raw`\put(${x},${-72 - i * 11}){\color{red}\tiny ${first + i}}`).join("\n");
}
function paper(layout: string, rulers: boolean) {
  const heading = ["Collection", "Storage", "Scheduling", "Validation", "Aggregation", "Recovery"];
  const sections = prose.map((text, i) => String.raw`\section{${heading[i]}}
${text}

The ${heading[i].toLowerCase()} experiment uses an independent record for every trial. Researchers can inspect the intermediate evidence before accepting an aggregate result. We retain the original inputs, the execution conditions, and the final observations together so that a later correction remains auditable.
`).join("\n");
  const numbered = rulers ? String.raw`\AddToShipoutPictureFG{\AtPageUpperLeft{\setlength{\unitlength}{1pt}
${ruler(34, 1)}
${layout === "twocolumn" ? ruler(567, 59) : ""}
}}` : "";
  return String.raw`\documentclass[letterpaper,${layout}]{article}
\usepackage[margin=60pt]{geometry}
\usepackage{eso-pic,xcolor,hyperref}
\setlength{\parskip}{4pt}
${numbered}
\title{A Controlled Study of Reproducible Measurement Pipelines}
\author{Example Author}
\date{}
\begin{document}
\maketitle
\begin{abstract}
We describe an experimental pipeline that preserves the evidence needed to compare repeated measurements. The study separates data collection, processing, and presentation while retaining links between their records.
\end{abstract}
${sections}
\end{document}
`;
}

const edits = [
  { layout: "onecolumn", column: -1, from: original, to: `${original} ${addition}`, expected: "when a delayed worker publishes its result" },
  { layout: "twocolumn", column: 0, from: original, to: `${original} ${addition}`, expected: "when a delayed worker publishes its result" },
  { layout: "twocolumn", column: 1, from: right, to: `${right} ${addition}`, expected: "when a delayed worker publishes its result" },
  { layout: "twocolumn", column: 1, from: "The measured limit is 25.", to: "The measured limit is 42.", expected: "is 42.", previous: "is 25." },
];
for (const { layout, column, from, to, expected, previous } of edits) {
  it.skipIf(!tex).each([true, false])(
    `keeps "${from}" local in ${layout} column ${column} with margin rulers %s`,
    async (rulers) => {
      const fixture = new Fixture();
      fixture.write("paper/main.tex", paper(layout, rulers));
      fixture.repo.run(["add", "."]);
      fixture.repo.run(["commit", "-qm", "Review ruler fixture"]);
      const app = fixture.app();
      try {
        const task = app.tasks.create("ruler");
        fixture.edit(task, "paper/main.tex", from, to);
        const job = app.publisher.submit(task.name);
        await app.publisher.join();
        const result = app.publisher.job(job.id);
        expect(result.status, JSON.stringify(result.result)).toBe("done");

        const round = app.review.roundDetail(task.name, 1);
        expect(round.units).toHaveLength(1);
        expect(round.units[0].visual).toBe("text");
        const changes = [
          ...round.sections.flatMap(section => section.blocks.filter(block => block.kind === "change")),
          ...round.loose,
        ];
        const before = changes.flatMap(block => block.before);
        const after = changes.flatMap(block => block.after);
        for (const strips of [before, after]) {
          expect(strips.length).toBeGreaterThan(0);
          expect(strips.reduce((height, strip) => height + strip.height, 0)).toBeLessThan(160);
          if (column === 0)
            expect(strips.every(strip => (strip.left ?? 0) + strip.width <= 306)).toBe(true);
          if (column === 1)
            expect(strips.every(strip => (strip.left ?? 0) >= 306)).toBe(true);
        }
        const printed = (strips: typeof after) => strips
          .flatMap(strip => strip.text?.map(line => line.text) ?? [])
          .join("\n").replace(/-\s*\n\s*/g, "").replace(/\s+/g, " ");
        expect(printed(after)).toContain(expected);
        if (previous) expect(printed(before)).toContain(previous);
      } finally {
        await fixture.close();
      }
    },
    90_000,
  );
}
