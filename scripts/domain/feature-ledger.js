// scripts/domain/feature-ledger.js -- the per-feature changes-ledger domain
// (window.SheetFeatureLedger). refreshFeatureLedger recomputes the full changes ledger once per
// feature-section render; featureBuffGroup returns the built-in changes a named feature contributes.
// Part D.1: a self-contained deep module (only window.SheetDetails / window.sheetChangesFull at
// call time), loaded before modals so the Features tab and modals' feature-buff menu import it
// directly.
window.SheetFeatureLedger = (function () {
    'use strict';

    let featureLedgerCache = null;
    function refreshFeatureLedger(data) {
        const SD = window.SheetDetails;
        featureLedgerCache = SD ? SD.collectChanges(data)
            : (window.sheetChangesFull || null);
        return featureLedgerCache;
    }
    /** Grouped built-in changes a feature (feat/trait/class feature) contributes, or null. */
    function featureBuffGroup(name) {
        const led = featureLedgerCache;
        if (!led || !name) return null;
        const lines = (led.changes || []).filter((c) => c.source === name);
        if (!lines.length) return null;
        return { source: name, sourceKind: lines[0].sourceKind || 'feat', lines };
    }

    return { refreshFeatureLedger, featureBuffGroup };
})();
