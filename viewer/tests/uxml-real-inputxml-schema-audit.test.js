import fs from 'fs';
import { describe, expect, it } from 'vitest';

describe('Agent 19 - Real InputXML Audit', () => {
  it('Verifies the generated audit and plan exist', () => {
    expect(fs.existsSync('Benchmarks/InputXML Schema Audit/1001-P-COPY-inputxml-audit.json')).toBe(true);
    expect(fs.existsSync('Benchmarks/InputXML Schema Audit/1001-P-COPY-inputxml-mapping-plan.md')).toBe(true);

    const planContent = fs.readFileSync('Benchmarks/InputXML Schema Audit/1001-P-COPY-inputxml-mapping-plan.md', 'utf8');

    expect(planContent).toContain('Root Tag and Namespace Report');
    expect(planContent).toContain('Top Tag Frequency');
    expect(planContent).toContain('Attribute Catalog by Tag');
    expect(planContent).toContain('Candidate Tags');
    expect(planContent).toContain('Source-field -> UXML-field mapping table');
    expect(planContent).toContain('Expected extraction counts');
    expect(planContent).toContain('Gaps/Ambiguities Requiring Fallback Logic');

    const auditData = JSON.parse(fs.readFileSync('Benchmarks/InputXML Schema Audit/1001-P-COPY-inputxml-audit.json', 'utf8'));
    expect(auditData.topTagFrequency['PIPINGELEMENT']).toBeGreaterThan(0);
  });
});
