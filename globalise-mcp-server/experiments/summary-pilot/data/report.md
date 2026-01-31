# Summary Pilot Experiment Results

Generated: 2026-01-31T10:25:10.730Z

## Overview

| Experiment | Model | Format | Success | Avg Latency | Total Cost | Cost/Page |
|------------|-------|--------|---------|-------------|------------|-----------|
| haiku-labeled | Haiku 4.5 | labeled | 100% | 2659ms | $0.0878 | $0.001791 |
| haiku-plaintext | Haiku 4.5 | plaintext | 100% | 2735ms | $0.0777 | $0.001587 |
| opus-plaintext | Opus 4.5 | plaintext | 100% | 6066ms | $0.4220 | $0.008612 |
| sonnet-labeled | Sonnet 4.5 | labeled | 100% | 5817ms | $0.2888 | $0.005894 |
| sonnet-plaintext | Sonnet 4.5 | plaintext | 100% | 5769ms | $0.2553 | $0.005210 |

## Quality Metrics

| Experiment | Avg Title Len | Titles in Range | Avg Abstract Words | Abstracts in Range |
|------------|---------------|-----------------|--------------------|--------------------|
| haiku-labeled | 69 chars | 88% | 62 words | 96% |
| haiku-plaintext | 69 chars | 86% | 62 words | 98% |
| opus-plaintext | 76 chars | 76% | 86 words | 96% |
| sonnet-labeled | 68 chars | 100% | 81 words | 100% |
| sonnet-plaintext | 67 chars | 100% | 79 words | 100% |

## Cost Analysis

- **Cheapest**: haiku-plaintext at $0.001587/page
- **Most expensive**: opus-plaintext at $0.008612/page
- **Cost ratio**: 5.4x

## Scaling Estimates (265 pages = full inventory)

| Experiment | Est. Cost (265 pages) | Est. Cost (4.8M pages) |
|------------|------------------------|------------------------|
| haiku-labeled | $0.47 | $8596 |
| haiku-plaintext | $0.42 | $7615 |
| opus-plaintext | $2.28 | $41339 |
| sonnet-labeled | $1.56 | $28289 |
| sonnet-plaintext | $1.38 | $25009 |

## Sample Outputs

### haiku-labeled

**NL-HaNA_1.04.02_10000_0004**
- Title: Official Correspondence to Governor-General Willem Arnold Alting regarding VOC Affairs
- Abstract: Formal letter addressed to Governor-General Willem Arnold Alting of the Dutch East India Company in Batavia, directed to the Council of the Netherlands Indies. The document appears to be a duplicate dispatch concerning an English vessel, the Atlas, with references to correspondence and official communications. The fragmentary nature suggests this is a cover page or header section of a larger administrative document from VOC records.

**NL-HaNA_1.04.02_10000_0009**
- Title: Ceylon Financial Demands and Currency Management, 1785
- Abstract: VOC correspondence addressing financial requisitions from Ceylon and measures to manage monetary circulation. Discusses constraints on private credit negotiation due to limited local resources, introduction of paper currency, copper coinage expansion, and interest rate increases to 9%. Documents coordination between chambers (Rotterdam, Amsterdam, Caab) regarding fund distribution and requests for sovereign financial support to meet Ceylon's monetary needs for 1785.

**NL-HaNA_1.04.02_10000_0010**
- Title: VOC Resolution on Emergency Relief Measures and Commodity Distribution
- Abstract: This document records VOC deliberations on emergency measures undertaken to address severe financial difficulties. The text discusses dependency on sovereign resolution regarding the Company's petition, and authorizes Commissioners to distribute Indian and Cape goods among regional chambers (kameren) as soon as feasible. Instructions are issued to chambers to remit allocated funds to India or the Cape at the earliest opportunity, reflecting urgent logistical and financial coordination during a period of constraint.

### haiku-plaintext

**NL-HaNA_1.04.02_10000_0004**
- Title: Letter to Governor-General Willem Arnold Alting regarding English Ship Atlas
- Abstract: Official VOC correspondence addressed to Governor-General Willem Arnold Alting in Batavia concerning the Dutch East India Company's dealings with an English vessel named the Atlas. The document appears to be a duplicate letter (Duplicaet) documenting the dispatch of the English ship, likely related to commercial or diplomatic matters between the VOC and English maritime interests in the East Indies during the 18th century.

**NL-HaNA_1.04.02_10000_0009**
- Title: Financial Management and Currency Arrangements for Ceylon, 1785
- Abstract: VOC correspondence addressing financial demands from Ceylon and measures to meet them. Discusses challenges in obtaining private credit due to limited resources among local inhabitants, introduction of paper money, copper coinage expansion, and interest rate increases to 9%. Details coordination between chambers (Rotterdam, Amsterdam, Cape) for fund distribution and requests for sovereign financial support to address currency shortages and commercial difficulties.

**NL-HaNA_1.04.02_10000_0010**
- Title: VOC Emergency Measures and Distribution of Indian and Cape Goods
- Abstract: This document discusses the VOC's desperate financial situation and emergency measures undertaken to address critical shortages. The text details plans for the Commissioners to distribute Indian and Cape goods among the respective chambers in June, contingent upon resolution from the sovereign authority. It emphasizes the urgent need for relief supplies and instructs the chambers to remit allocated funds to India and the Cape at the earliest opportunity.

### opus-plaintext

**NL-HaNA_1.04.02_10000_0004**
- Title: Duplicate Letter to Governor-General Willem Arnold Alting at Batavia
- Abstract: Opening address of a duplicate letter sent via the English ship 'Atlas' to Governor-General Willem Arnold Alting and the Council of the Netherlands Indies at Batavia. The document follows formal VOC correspondence protocol, addressing the highest colonial authority representing the Free United Netherlands and the Dutch East India Company. The use of an English vessel for transmission suggests this was a secondary routing of official correspondence, a common practice to ensure delivery of important communications.

**NL-HaNA_1.04.02_10000_0009**
- Title: VOC Financial Administration for Ceylon: Currency Issues and Chamber Allocations
- Abstract: This document discusses the financial demands (geldeischen) from Ceylon, emphasizing the need for careful and frugal budget management. It addresses the difficulty of negotiating funds from private individuals due to the limited means of Ceylon's inhabitants. The text mentions the introduction of paper money and copper coinage, interest rate increases to 9 percent, and the distribution of goods among VOC chambers (Rotterdam and Amsterdam). A petition to the sovereign for financial support is referenced, along with budget allocations for 1785 totaling 13 tons, and coordination with Cape (Kaap) ministers regarding fund transfers.

**NL-HaNA_1.04.02_10000_0010**
- Title: VOC Financial Distress and Request for Relief from Sovereign Authority
- Abstract: This document reveals the VOC facing severe financial difficulties, having exhausted various emergency measures ('hulpmiddelen') to address their predicament. The directors express urgent need for relief and indicate that without prompt assistance, private trade will collapse entirely. The text references commissioners assigned to regular meetings in The Hague scheduled for early June, who are authorized to distribute Indian and Cape ('Caabsche') goods that remain undivided among the respective chambers (kameren). The chambers are requested to forward allocated funds to India or the Cape at the earliest opportunity. The document reflects the late VOC period's financial crisis and administrative coordination between chambers.

### sonnet-labeled

**NL-HaNA_1.04.02_10000_0004**
- Title: Letter to Governor-General Willem Arnold Alting via English Ship Atlas
- Abstract: Official correspondence addressed to Governor-General Willem Arnold Alting and the Council of the Dutch East Indies in Batavia. The document is a duplicate letter sent via the English private ship 'Atlas'. Alting served as VOC Governor-General from 1780-1796, placing this document in the late 18th century. The letter demonstrates formal diplomatic communication channels between VOC officials, utilizing both Dutch and English vessels for correspondence delivery during this period.

**NL-HaNA_1.04.02_10000_0009**
- Title: VOC Financial Correspondence on Ceylon and Cape Payment Demands, 1785
- Abstract: This document discusses the VOC's financial challenges in meeting payment demands from Ceylon and the Cape. It addresses the difficulty of negotiating credit with private individuals in Ceylon due to limited local resources, the introduction of paper money and its limitations, and increased interest rates to 9%. The correspondence details the distribution of goods across VOC chambers (Rotterdam and Amsterdam) and requests financial support from the sovereign to fulfill payment obligations totaling 13,000 for 1785.

**NL-HaNA_1.04.02_10000_0010**
- Title: VOC Financial Crisis and Request for Relief from Sovereign, ca. 1780s
- Abstract: This document describes the VOC's severe financial difficulties and emergency measures taken to address them. The Company awaits a crucial decision from the sovereign regarding their petition for assistance. Commissioners are appointed to handle routine Hague business and to distribute remaining Indian and Cape goods among the respective chambers. The chambers are requested to send allocated funds to India or the Cape at the earliest opportunity. The text reveals the Company's desperate financial state and dependence on government intervention, while private trade suffers as the Company absorbs available resources.

### sonnet-plaintext

**NL-HaNA_1.04.02_10000_0004**
- Title: Letter to Governor-General Willem Arnold Alting regarding English Ship Atlas
- Abstract: Official correspondence addressed to Governor-General Willem Arnold Alting in Batavia from the Council of Netherlands India. The document references a duplicate letter sent via the English ship 'Atlas'. Alting served as Governor-General of the Dutch East Indies (1780-1796), and this communication appears to concern maritime correspondence procedures between VOC officials, utilizing an English vessel as a carrier for official Dutch colonial dispatches.

**NL-HaNA_1.04.02_10000_0009**
- Title: VOC Financial Management: Ceylon Monetary Demands and Credit Policies, 1785
- Abstract: This document discusses the VOC's financial challenges in Ceylon, emphasizing careful management of monetary demands due to limited local credit opportunities. Key topics include the introduction of paper money and its limitations, increased interest rates to 9%, copper coinage issues, and distribution of goods among VOC chambers (Rotterdam and Amsterdam). The text addresses a request for financial support of 13,000 guilders for 1785 and coordination with Cape officials regarding monetary policies and their impact on both Company and private trade.

**NL-HaNA_1.04.02_10000_0010**
- Title: VOC Financial Crisis and Request for Relief from Sovereign, ca. 1780s
- Abstract: This document describes the VOC's severe financial difficulties and emergency measures taken to address them. The Company awaits a decision from the sovereign regarding their petition for relief. Commissioners are tasked with distributing undivided Indian and Cape goods among the respective chambers during the upcoming June meeting in The Hague. Chambers are requested to send allocated funds to India or the Cape at the earliest opportunity. The text reflects the Company's desperate financial situation and dependence on governmental intervention.
