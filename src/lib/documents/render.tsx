import "server-only";
import { createElement as h, type ReactElement } from "react";
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import QRCode from "qrcode";
import type { DocumentModel, Section, TableSpec } from "./model";

/**
 * The one renderer every produced document goes through: an A4 page in
 * the house palette, the lessor's block, the tenant's, the date, the
 * subject, the blocks the composer laid out, the signature and a footer
 * naming the template version. Only drawing happens here; the words come
 * composed and the legal figures came from the registry.
 */
const BRAND = "#14636f";
const INK = "#1f2a30";
const SOFT = "#5b6770";
const RULE = "#d9d4c8";
const ZEBRA = "#f6f4ef";

const styles = StyleSheet.create({
  page: { paddingTop: 56, paddingBottom: 64, paddingHorizontal: 56, fontFamily: "Helvetica", fontSize: 10.5, lineHeight: 1.45, color: INK },
  head: { flexDirection: "row", justifyContent: "space-between", marginBottom: 22 },
  party: { maxWidth: "48%" },
  partyLabel: { fontSize: 7.5, color: SOFT, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 2 },
  partyName: { fontFamily: "Helvetica-Bold", fontSize: 11 },
  partyLine: { fontSize: 9.5, color: SOFT },
  meta: { marginBottom: 14, fontSize: 9.5, color: SOFT },
  title: { fontFamily: "Helvetica-Bold", fontSize: 18, color: BRAND, marginBottom: 4 },
  subtitle: { fontSize: 10.5, color: SOFT, marginBottom: 10 },
  subject: { fontFamily: "Helvetica-Bold", marginBottom: 12 },
  heading: { fontFamily: "Helvetica-Bold", fontSize: 10, color: BRAND, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 12, marginBottom: 5 },
  paragraph: { marginBottom: 7, textAlign: "justify" },
  note: { fontSize: 8.5, color: SOFT, marginTop: 4, marginBottom: 6 },
  kvRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3, borderBottomWidth: 0.5, borderBottomColor: RULE },
  kvKey: { color: SOFT, fontSize: 9.5 },
  kvValue: { fontFamily: "Helvetica-Bold", fontSize: 10 },
  table: { marginTop: 4, marginBottom: 8 },
  tr: { flexDirection: "row", paddingVertical: 3.5, paddingHorizontal: 4, borderBottomWidth: 0.5, borderBottomColor: RULE },
  th: { fontSize: 7.5, color: SOFT, textTransform: "uppercase", letterSpacing: 0.4 },
  td: { fontSize: 9.5 },
  total: { fontFamily: "Helvetica-Bold" },
  qr: { flexDirection: "row", alignItems: "center", marginTop: 8 },
  qrImage: { width: 96, height: 96, marginRight: 12 },
  qrCaption: { fontSize: 8.5, color: SOFT, flex: 1 },
  closing: { marginTop: 10 },
  signatures: { flexDirection: "row", justifyContent: "space-between", marginTop: 26 },
  signature: { width: "45%" },
  signatureLabel: { fontSize: 8.5, color: SOFT, marginBottom: 28 },
  signatureName: { fontFamily: "Helvetica-Bold", borderTopWidth: 0.5, borderTopColor: RULE, paddingTop: 4 },
  footer: { position: "absolute", left: 56, right: 56, bottom: 28, fontSize: 7.5, color: SOFT, flexDirection: "row", justifyContent: "space-between" },
  watermark: { position: "absolute", top: 340, left: 40, right: 40, textAlign: "center", fontSize: 34, color: "#c9c2b6", opacity: 0.5, transform: "rotate(-24deg)", fontFamily: "Helvetica-Bold" },
});

function Table({ spec }: { spec: TableSpec }): ReactElement {
  const widths = spec.columns.map((c) => c.width ?? 1);
  const sum = widths.reduce((a, b) => a + b, 0);
  const cell = (i: number, text: string, bold = false) =>
    h(Text, { key: i, style: { ...styles.td, ...(bold ? styles.total : {}), width: `${(widths[i] / sum) * 100}%`, textAlign: spec.columns[i].align ?? "left", paddingRight: 4 } }, text);
  return h(
    View,
    { style: styles.table },
    h(View, { style: styles.tr }, spec.columns.map((c, i) => h(Text, { key: i, style: { ...styles.th, width: `${(widths[i] / sum) * 100}%`, textAlign: c.align ?? "left" } }, c.label))),
    ...spec.rows.map((row, r) => h(View, { key: r, style: r % 2 === 1 ? { ...styles.tr, backgroundColor: ZEBRA } : styles.tr }, row.map((text, i) => cell(i, text)))),
    spec.total ? h(View, { style: styles.tr }, spec.total.map((text, i) => cell(i, text, true))) : null,
  );
}

function SectionView({ section, qr }: { section: Section; qr: string | null }): ReactElement {
  return h(
    View,
    null,
    section.heading ? h(Text, { style: styles.heading }, section.heading) : null,
    ...(section.paragraphs ?? []).map((p, i) => h(Text, { key: `p${i}`, style: styles.paragraph }, p)),
    section.keyValues
      ? h(View, null, section.keyValues.map(([k, v], i) => h(View, { key: i, style: styles.kvRow }, h(Text, { style: styles.kvKey }, k), h(Text, { style: styles.kvValue }, v))))
      : null,
    section.table ? h(Table, { spec: section.table }) : null,
    section.note ? h(Text, { style: styles.note }, section.note) : null,
    section.qr && qr ? h(View, { style: styles.qr }, h(Image, { style: styles.qrImage, src: qr }), h(Text, { style: styles.qrCaption }, section.qr.caption)) : null,
  );
}

function Party({ label, name, lines }: { label: string; name: string; lines: string[] }): ReactElement {
  return h(View, { style: styles.party }, h(Text, { style: styles.partyLabel }, label), h(Text, { style: styles.partyName }, name), ...lines.map((l, i) => h(Text, { key: i, style: styles.partyLine }, l)));
}

async function qrImages(model: DocumentModel): Promise<Array<string | null>> {
  return Promise.all(model.sections.map((s) => (s.qr ? QRCode.toDataURL(s.qr.payload, { errorCorrectionLevel: "M", margin: 1, scale: 4 }) : Promise.resolve(null))));
}

export interface RenderLabels {
  sender: string;
  recipient: string;
  reference: string;
  subject: string;
  page: string;
}

export async function renderPdf(model: DocumentModel, labels: RenderLabels): Promise<Buffer> {
  const qrs = await qrImages(model);
  const doc = h(
    Document,
    { title: model.title, author: model.sender.name, subject: model.subject ?? model.title, creator: "Morada Gestion", producer: "Morada Gestion" },
    h(
      Page,
      { size: "A4", style: styles.page },
      model.watermark ? h(Text, { style: styles.watermark, fixed: true }, model.watermark) : null,
      h(
        View,
        { style: styles.head },
        h(Party, { label: labels.sender, name: model.sender.name, lines: model.sender.lines }),
        model.recipient ? h(Party, { label: labels.recipient, name: model.recipient.name, lines: model.recipient.lines }) : null,
      ),
      h(Text, { style: styles.meta }, model.dateLine + (model.reference ? `   ·   ${labels.reference} ${model.reference}` : "")),
      h(Text, { style: styles.title }, model.title),
      model.subtitle ? h(Text, { style: styles.subtitle }, model.subtitle) : null,
      model.subject ? h(Text, { style: styles.subject }, `${labels.subject} : ${model.subject}`) : null,
      ...model.sections.map((section, i) => h(SectionView, { key: i, section, qr: qrs[i] })),
      model.closing && model.closing.length > 0 ? h(View, { style: styles.closing }, ...model.closing.map((c, i) => h(Text, { key: i, style: styles.paragraph }, c))) : null,
      model.signature
        ? h(
            View,
            { style: styles.signatures },
            h(View, { style: styles.signature }, h(Text, { style: styles.signatureLabel }, model.signature.label), h(Text, { style: styles.signatureName }, model.signature.name)),
            model.signature.second ? h(View, { style: styles.signature }, h(Text, { style: styles.signatureLabel }, model.signature.second.label), h(Text, { style: styles.signatureName }, model.signature.second.name)) : null,
          )
        : null,
      h(
        View,
        { style: styles.footer, fixed: true },
        h(Text, { style: { flex: 1, paddingRight: 12 } }, model.footer),
        h(Text, { render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) => `${labels.page} ${pageNumber}/${totalPages}` }),
      ),
    ),
  );
  return renderToBuffer(doc);
}
