export class RvmTreeModel {
    constructor(rvmIndex, viewerContext) {
        this.rvmIndex = rvmIndex;
        this.viewerContext = viewerContext; // needs { viewer: RvmViewer3D }

        this._rootNodes = [];
        this._treeMap = new Map(); // canonicalId -> tree node obj
        this._checkboxMap = new Map(); // canonicalId -> checkbox element
        this._liMap = new Map(); // canonicalId -> li element
    }

    build() {
        this._rootNodes = [];
        this._treeMap.clear();
        this._checkboxMap.clear();
        this._liMap.clear();

        if (!this.rvmIndex || !this.rvmIndex.nodes) return;

        // Pass 1: Create all tree node objects
        for (const node of this.rvmIndex.nodes) {
            const treeNode = {
                canonicalObjectId: node.canonicalObjectId,
                name: node.name || node.canonicalObjectId,
                kind: node.kind,
                parentCanonicalObjectId: node.parentCanonicalObjectId,
                children: []
            };
            this._treeMap.set(node.canonicalObjectId, treeNode);
        }

        // Pass 2: Link children to parents
        for (const [id, treeNode] of this._treeMap) {
            if (treeNode.parentCanonicalObjectId) {
                const parent = this._treeMap.get(treeNode.parentCanonicalObjectId);
                if (parent) {
                    parent.children.push(treeNode);
                } else {
                    // Parent not found, treat as root
                    this._rootNodes.push(treeNode);
                }
            } else {
                this._rootNodes.push(treeNode);
            }
        }
    }

    /**
     * Returns all descendant canonical ids, optionally including self.
     */
    getDescendantCanonicalIds(canonicalObjectId, includeSelf = false) {
        const result = [];
        const treeNode = this._treeMap.get(canonicalObjectId);
        if (!treeNode) return result;

        const visit = (node) => {
            result.push(node.canonicalObjectId);
            for (const child of node.children) {
                visit(child);
            }
        };

        if (includeSelf) {
            visit(treeNode);
        } else {
            for (const child of treeNode.children) {
                visit(child);
            }
        }

        return result;
    }

    /**
     * Update checkbox DOM states to match the given set of selected ids.
     */
    setSelectedCanonicalIds(ids, options = {}) {
        const selectedSet = new Set(ids);

        // Update each checkbox and li state
        for (const [id, checkbox] of this._checkboxMap) {
            const li = this._liMap.get(id);
            const descendants = this.getDescendantCanonicalIds(id, false);
            const isChecked = selectedSet.has(id);

            if (checkbox) {
                checkbox._checked = isChecked;
            }
            if (li) {
                li.classList.toggle
                    ? li.classList.toggle('is-checked', isChecked)
                    : null;

                // Determine indeterminate state (partial child selection)
                if (descendants.length > 0) {
                    const checkedDescendants = descendants.filter(d => selectedSet.has(d));
                    const isIndeterminate = !isChecked && checkedDescendants.length > 0;
                    if (li.classList.toggle) {
                        li.classList.toggle('is-indeterminate', isIndeterminate);
                    }
                    if (checkbox) {
                        checkbox.indeterminate = isIndeterminate;
                    }
                }
            }
        }
    }

    clearSelection() {
        for (const [id, checkbox] of this._checkboxMap) {
            if (checkbox) checkbox._checked = false;
            const li = this._liMap.get(id);
            if (li && li.classList) {
                if (li.classList.remove) {
                    li.classList.remove('is-checked', 'is-indeterminate');
                } else {
                    li.className = li.className.replace(/is-checked|is-indeterminate/g, '').trim();
                }
            }
        }
    }

    renderTree(containerEl) {
        if (!containerEl) return;
        containerEl.innerHTML = '';

        if (this._rootNodes.length === 0) {
            containerEl.innerHTML = '<div class="rvm-tree-empty">No hierarchy available</div>';
            return;
        }

        const ul = document.createElement('ul');
        ul.className = 'rvm-tree-root';

        for (const root of this._rootNodes) {
            ul.appendChild(this._renderTreeNode(root));
        }

        containerEl.appendChild(ul);
    }

    _renderTreeNode(treeNode) {
        const li = document.createElement('li');
        li.className = 'rvm-tree-node';
        li.dataset.id = treeNode.canonicalObjectId;
        this._liMap.set(treeNode.canonicalObjectId, li);

        const labelDiv = document.createElement('div');
        labelDiv.className = 'rvm-tree-label';

        // If it has children, add a toggle
        if (treeNode.children.length > 0) {
            const toggleSpan = document.createElement('span');
            toggleSpan.className = 'rvm-tree-toggle';
            toggleSpan.textContent = '▶'; // Can be styled via CSS or toggle classes
            toggleSpan.onclick = (e) => {
                e.stopPropagation();
                li.classList.toggle('rvm-tree-expanded');
                toggleSpan.textContent = li.classList.contains('rvm-tree-expanded') ? '▼' : '▶';
            };
            labelDiv.appendChild(toggleSpan);
        } else {
            const spacerSpan = document.createElement('span');
            spacerSpan.className = 'rvm-tree-spacer';
            labelDiv.appendChild(spacerSpan);
        }

        // Checkbox for multi-select
        const checkbox = document.createElement('input');
        checkbox.className = 'rvm-tree-checkbox';
        checkbox.type = 'checkbox';
        checkbox._checked = false;
        this._checkboxMap.set(treeNode.canonicalObjectId, checkbox);

        checkbox.onclick = (e) => {
            e.stopPropagation();
            const ids = this.getDescendantCanonicalIds(treeNode.canonicalObjectId, true);
            if (this.viewerContext && this.viewerContext.viewer && this.viewerContext.viewer.selectCanonicalIds) {
                this.viewerContext.viewer.selectCanonicalIds(ids);
            }
        };

        labelDiv.appendChild(checkbox);

        const textSpan = document.createElement('span');
        textSpan.className = 'rvm-tree-text';
        const kind = String(treeNode.kind || '').trim();
        textSpan.textContent = kind && kind !== 'UNKNOWN'
          ? `[${kind}] ${treeNode.name}`
          : treeNode.name;
        labelDiv.appendChild(textSpan);

        // Click on the node text selects it in the viewer (single select)
        labelDiv.onclick = (e) => {
            e.stopPropagation();
            if (this.viewerContext && this.viewerContext.viewer) {
                this.viewerContext.viewer.selectByCanonicalId(treeNode.canonicalObjectId);
            }
        };

        li.appendChild(labelDiv);

        if (treeNode.children.length > 0) {
            const ul = document.createElement('ul');
            ul.className = 'rvm-tree-children';
            for (const child of treeNode.children) {
                ul.appendChild(this._renderTreeNode(child));
            }
            li.appendChild(ul);
        }

        return li;
    }

    dispose() {
        this._rootNodes = [];
        this._treeMap.clear();
        this._checkboxMap.clear();
        this._liMap.clear();
        this.rvmIndex = null;
        this.viewerContext = null;
    }
}
