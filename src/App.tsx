import { useState } from 'react';
import { Link, IconButton, Text } from '@capra/core';
import { CopyOutlined, CheckOutlined } from '@capra/icons';
import { EmptySuitcase } from '@capra/icons/images';

const PURPOSE = "Create a Cribl.Cloud App called \"Fleet Pack Explorer\".\n\nPurpose:\nProvide visibility into pack inheritance across Fleets and help administrators understand which packs and knowledge objects are inherited by each Fleet.\n\nRequirements:\n\n1. Fleet Inventory View\n- Display all Fleets in a table.\n- Show Fleet name and summary information.\n- Allow selecting a Fleet to view details.\n\n2. Inheritance Visualization\n- Display a visual hierarchy showing:\n  - Fleets\n  - Inherited Packs\n  - Knowledge Objects contained within Packs\n- Clearly indicate inheritance relationships.\n- Allow expanding and collapsing nodes.\n\n3. Pack Explorer\n- Display all Packs available in the environment.\n- Allow searching and filtering Packs.\n- Selecting a Pack should show:\n  - Pack metadata\n  - Associated Knowledge Objects\n  - Fleets inheriting the Pack\n\n4. Knowledge Object Explorer\n- Display Knowledge Objects from selected Packs.\n- Show where each object is inherited.\n- Provide search and filtering.\n\n5. User Experience\n- Use the Capra design system.\n- Build a clean dashboard layout with navigation tabs:\n  - Fleets\n  - Packs\n  - Knowledge Objects\n- Use tables and visual relationship diagrams.\n- Include loading, empty, and error states.\n\n6. Technical Requirements\n- Use documented Cribl APIs only.\n- Read-only functionality for the initial version.\n- Structure the code so future releases can support:\n  - Change impact analysis\n  - Fleet update workflows\n  - Bulk propagation of knowledge-object updates\n  - Approval and rollback capabilities\n\nGoal:\nGive administrators a single place to understand Fleet-to-Pack inheritance relationships and determine where knowledge objects are being inherited before making changes.\n``";

function App() {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    // Apps run in a sandboxed iframe, where writeText can reject (permission denied, or no
    // clipboard-write grant). Swallow it rather than leaving an unhandled rejection in the
    // developer's console on their first run — the button simply won't flip to the check state.
    navigator.clipboard
      .writeText(PURPOSE)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => undefined);
  };

  return (
    <div className="landing-page">
      <div className="landing-content">
        <div className="illustration">
          <EmptySuitcase size="lg" />
        </div>
        <div className="landing-info">
          <Text as="h1" variant="heading">
            <span className="text-green">Your app is running.</span> Now let's build your idea.
          </Text>
          {PURPOSE && (
            <>
              <Text>Copy and paste your prompt into your IDE tool.</Text>
              <div className="snippet-box">
                <Text as="pre" variant="code">{PURPOSE}</Text>
                <IconButton
                  onPress={handleCopy}
                  aria-label="Copy to clipboard"
                  icon={copied ? CheckOutlined : CopyOutlined}
                />
              </div>
            </>
          )}
          <Link href="https://docs.cribl.io/apps" isExternal>
            Learn more
          </Link>
        </div>
      </div>
    </div>
  );
}

export default App;
