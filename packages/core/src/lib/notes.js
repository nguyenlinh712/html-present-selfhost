'use strict';

function attrValue(attrs, name) {
  const re = new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i');
  const match = String(attrs || '').match(re);
  return match ? (match[1] || match[2] || match[3] || '') : '';
}

function decodeEntities(value) {
  return String(value || '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, entity) => {
    const key = entity.toLowerCase();
    if (key === 'amp') return '&'; if (key === 'lt') return '<'; if (key === 'gt') return '>';
    if (key === 'quot') return '"'; if (key === 'apos') return "'"; if (key === 'nbsp') return ' ';
    const n = key.startsWith('#x') ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
    return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
  });
}

function plainText(html) {
  return decodeEntities(String(html || '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[^]*?-->/g, ' ').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function findSlideBlocks(html) {
  const source = String(html || '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, block => ' '.repeat(block.length));
  const tags = /<!--[^]*?-->|<[^>]*>/g;
  const active = [];
  const blocks = [];
  let match;
  while ((match = tags.exec(source))) {
    const token = match[0];
    if (token.startsWith('<!--')) continue;
    const tag = token.match(/^<\s*(\/?)\s*([a-z][a-z0-9:-]*)\b([^>]*)>/i);
    if (!tag) continue;
    const closing = !!tag[1], name = tag[2].toLowerCase(), attrs = tag[3] || '';
    if (closing) {
      for (let i = active.length - 1; i >= 0; i--) {
        const item = active[i]; if (item.tag !== name) continue;
        item.depth--;
        if (item.depth === 0) {
          item.end = match.index;
          blocks.push(item);
          active.splice(i, 1);
        }
      }
      continue;
    }

    for (const item of active) if (item.tag === name) item.depth++;
    const className = attrValue(attrs, 'class').split(/\s+/);
    const isSlide = (name === 'section' && (!!attrValue(attrs, 'id') || className.includes('slide')))
      || (name === 'div' && className.includes('slide'));
    if (isSlide) active.push({ tag: name, depth: 1, start: match.index, openEnd: tags.lastIndex, attrs });
  }
  const slides = blocks.filter(item => item.tag === 'div' && attrValue(item.attrs, 'class').split(/\s+/).includes('slide'));
  const sections = blocks.filter(item => item.tag === 'section' && (!!attrValue(item.attrs, 'id') || attrValue(item.attrs, 'class').split(/\s+/).includes('slide')));
  return slides.length ? slides.sort((a, b) => a.start - b.start) : sections.sort((a, b) => a.start - b.start);
}

function extractSlides(html) {
  const source = String(html || '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, block => ' '.repeat(block.length));
  return findSlideBlocks(source).slice(0, 200).map((block, i) => {
    const inner = source.slice(block.openEnd, block.end);
    const id = attrValue(block.attrs, 'id');
    const heading = inner.match(/<h[12]\b[^>]*>([\s\S]*?)<\/h[12]\s*>/i);
    const title = plainText(heading ? heading[1] : '') || id || `Slide ${i + 1}`;
    const dataNote = attrValue(block.attrs, 'data-note');
    const aside = inner.match(/<aside\b([^>]*)>([\s\S]*?)<\/aside\s*>/i);
    const asideNote = aside && /(?:^|\s)notes(?:\s|$)/i.test(attrValue(aside[1], 'class')) ? plainText(aside[2]) : '';
    return { idx: i + 1, id, title: title.slice(0, 240), note: decodeEntities(dataNote).trim() || asideNote };
  });
}

function projectNotes(project, relPath) {
  const all = project && project.notes && typeof project.notes === 'object' && !Array.isArray(project.notes) ? project.notes : {};
  const found = all[String(relPath || '')];
  if (!found || typeof found !== 'object' || Array.isArray(found)) return {};
  const clean = {};
  for (const [idx, value] of Object.entries(found).slice(0, 200)) {
    if (!/^\d{1,3}$/.test(idx) || Number(idx) < 1 || typeof value !== 'string') continue;
    clean[idx] = value.slice(0, 5000);
  }
  return clean;
}

module.exports = { extractSlides, projectNotes };
