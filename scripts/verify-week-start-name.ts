import { strict as assert } from 'node:assert';
import { weekStartMonthDay } from '../src/workspace-registry';
import { setLanguage, t } from '../src/i18n';

// The + button's default weekly-board name carries the Sunday that starts the
// current week (weeks begin on Sunday), whatever day of that week the board
// is created on: Fri 2026-09-18 -> "第2周-9月13号".

function defaultName(fileCount: number, now: Date, lang: 'en' | 'zh'): string {
	setLanguage(lang);
	const { month, day } = weekStartMonthDay(now);
	return t('workspace.defaultWeeklyName', { n: fileCount + 1, month, day });
}

async function main(): Promise<void> {
	// 1. The user's example: Fri 2026-09-18 sits in the week starting Sun 9/13.
	assert.deepEqual(weekStartMonthDay(new Date(2026, 8, 18)), { month: 9, day: 13 }, '1: Friday maps to its Sunday');

	// 2. Every other day of that same week maps to the same Sunday — the
	//    Sunday itself (week start) through the Saturday (week end).
	for (const d of [13, 14, 15, 16, 17, 19]) {
		assert.deepEqual(weekStartMonthDay(new Date(2026, 8, d)), { month: 9, day: 13 }, `2: Sep ${d} maps to Sep 13`);
	}

	// 3. Month rollover: Tue 2026-09-01 belongs to the week starting Sun 8/30.
	assert.deepEqual(weekStartMonthDay(new Date(2026, 8, 1)), { month: 8, day: 30 }, '3: month rollover');

	// 4. Year rollover: Fri 2027-01-01 belongs to the week starting Sun 2026-12-27.
	assert.deepEqual(weekStartMonthDay(new Date(2027, 0, 1)), { month: 12, day: 27 }, '4: year rollover');

	// 5. Composed default name (the prompt dialog's pre-filled value):
	//    zh formats M月D号, en formats M/D; n stays the file-count sequence.
	assert.equal(defaultName(1, new Date(2026, 8, 18), 'zh'), '第2周-9月13号', '5: zh default name');
	assert.equal(defaultName(1, new Date(2026, 8, 18), 'en'), 'Week 2 - 9/13', '5: en default name');

	console.log('verify-week-start-name: 5 scenarios OK');
}

void main();
