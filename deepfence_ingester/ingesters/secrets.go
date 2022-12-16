package ingesters

import (
	"fmt"
	"time"

	"github.com/deepfence/ThreatMapper/deepfence_utils/directory"
	"github.com/deepfence/ThreatMapper/deepfence_utils/utils"
	"github.com/neo4j/neo4j-go-driver/v4/neo4j"
)

type SecretScanStatus struct {
	Timestamp             time.Time `json:"@timestamp"`
	ContainerName         string    `json:"container_name"`
	HostName              string    `json:"host_name"`
	KubernetesClusterName string    `json:"kubernetes_cluster_name"`
	Masked                string    `json:"masked"`
	NodeID                string    `json:"node_id"`
	NodeName              string    `json:"node_name"`
	NodeType              string    `json:"node_type"`
	ScanID                string    `json:"scan_id"`
	ScanStatus            string    `json:"scan_status"`
}

type Secret struct {
	Timestamp    time.Time `json:"@timestamp"`
	ImageLayerID string    `json:"ImageLayerId"`
	Match        struct {
		StartingIndex         int    `json:"starting_index"`
		RelativeStartingIndex int    `json:"relative_starting_index"`
		RelativeEndingIndex   int    `json:"relative_ending_index"`
		FullFilename          string `json:"full_filename"`
		MatchedContent        string `json:"matched_content"`
	} `json:"Match"`
	Rule struct {
		ID               int    `json:"id"`
		Name             string `json:"name"`
		Part             string `json:"part"`
		SignatureToMatch string `json:"signature_to_match"`
	} `json:"Rule"`
	Severity struct {
		Level string  `json:"level"`
		Score float64 `json:"score"`
	} `json:"Severity"`
	ContainerName         string `json:"container_name"`
	HostName              string `json:"host_name"`
	KubernetesClusterName string `json:"kubernetes_cluster_name"`
	Masked                string `json:"masked"`
	NodeID                string `json:"node_id"`
	NodeName              string `json:"node_name"`
	NodeType              string `json:"node_type"`
	ScanID                string `json:"scan_id"`
}

func CommitFuncSecrets(ns string, data []Secret) error {
	ctx := directory.NewContextWithNameSpace(directory.NamespaceID(ns))
	driver, err := directory.Neo4jClient(ctx)
	if err != nil {
		return err
	}

	session := driver.NewSession(neo4j.SessionConfig{AccessMode: neo4j.AccessModeWrite})
	if err != nil {
		return err
	}
	defer session.Close()

	tx, err := session.BeginTransaction()
	if err != nil {
		return err
	}
	defer tx.Close()

	if _, err = tx.Run("UNWIND $batch as row WITH row.Rule as rule, row.Secret as secret MERGE (r:Rule{node_id:rule.id}) SET r+=rule WITH secret as row, r MERGE (n:Secret{node_id:row.rule_id}) MERGE (n)-[:IS]->(r) MERGE (m:SecretScan{node_id: row.scan_id, host_name: row.host_name, time_stamp: timestamp()}) WITH n, m, row MATCH (l:Node{node_id: row.host_name}) MERGE (m) -[:DETECTED]-> (n) MERGE (m) -[:SCANNED]-> (l) SET n+= row",
		map[string]interface{}{"batch": secretsToMaps(data)}); err != nil {
		return err
	}

	return tx.Commit()
}

func CommitFuncSecretScanStatus(ns string, data []SecretScanStatus) error {
	ctx := directory.NewContextWithNameSpace(directory.NamespaceID(ns))
	driver, err := directory.Neo4jClient(ctx)

	if len(data) == 0 {
		return nil
	}

	if err != nil {
		return err
	}

	session := driver.NewSession(neo4j.SessionConfig{AccessMode: neo4j.AccessModeWrite})
	if err != nil {
		return err
	}
	defer session.Close()

	tx, err := session.BeginTransaction()
	if err != nil {
		return err
	}
	defer tx.Close()

	if _, err = tx.Run("UNWIND $batch as row MERGE (n:SecretScan{node_id: row.scan_id}) SET n.status = row.scan_status",
		map[string]interface{}{"batch": statusesToMaps(data)}); err != nil {
		return err
	}

	return tx.Commit()
}

func statusesToMaps(data []SecretScanStatus) []map[string]interface{} {
	statuses := []map[string]interface{}{}
	for _, i := range data {
		statuses = append(statuses, utils.ToMap(i))
	}
	return statuses
}

func secretsToMaps(data []Secret) []map[string]map[string]interface{} {
	secrets := []map[string]map[string]interface{}{}
	for _, i := range data {
		secret := utils.ToMap(i)
		delete(secret, "Severity")
		delete(secret, "Rule")
		delete(secret, "Match")

		for k, v := range utils.ToMap(i.Severity) {
			secret[k] = v
		}
		for k, v := range utils.ToMap(i.Match) {
			secret[k] = v
		}
		secret["rule_id"] = fmt.Sprintf("%v:%v", i.Rule.ID, i.HostName)
		secrets = append(secrets, map[string]map[string]interface{}{
			"Rule":   utils.ToMap(i.Rule),
			"Secret": secret,
		})
	}
	return secrets
}