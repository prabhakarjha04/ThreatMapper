package reporters

import (
	"context"

	"github.com/deepfence/ThreatMapper/deepfence_server/model"
	"github.com/deepfence/ThreatMapper/deepfence_utils/directory"
	"github.com/deepfence/ThreatMapper/deepfence_utils/utils"
	"github.com/neo4j/neo4j-go-driver/v4/neo4j"
	"github.com/neo4j/neo4j-go-driver/v4/neo4j/dbtype"
	"github.com/rs/zerolog/log"
)

// If no nodeIds are provided, will return all
// If no field are provided, will return all fields
type SearchFilter struct {
	InFieldFilter map[string]struct{} `json:"in_field_filter" required:"true"` // Fields to return
	NodeIds       map[string]struct{} `json:"node_ids" required:"true"`        // Node to return
}

func GetHostsReport(ctx context.Context, filter SearchFilter) ([]model.Host, error) {
	hosts, err := getGenericDirectNodeReport[model.Host](ctx, filter)
	if err != nil {
		return nil, err
	}
	for i := range hosts {
		processes, err := getHostProcesses(ctx, hosts[i])
		if err != nil {
			return nil, err
		}
		hosts[i].Processes = processes

		containers, err := getHostContainers(ctx, hosts[i])
		if err != nil {
			return nil, err
		}
		hosts[i].Containers = containers
	}
	return hosts, nil
}

func GetContainersReport(ctx context.Context, filter SearchFilter) ([]model.Container, error) {
	containers, err := getGenericDirectNodeReport[model.Container](ctx, filter)
	if err != nil {
		return nil, err
	}
	for i := range containers {
		processes, err := getContainerProcesses(ctx, containers[i])
		if err != nil {
			return nil, err
		}
		containers[i].Processes = processes
	}
	return containers, nil
}

func GetProcessesReport(ctx context.Context, filter SearchFilter) ([]model.Process, error) {
	processes, err := getGenericDirectNodeReport[model.Process](ctx, filter)
	if err != nil {
		return nil, err
	}
	return processes, nil
}

func getGenericDirectNodeReport[T any](ctx context.Context, filter SearchFilter) ([]T, error) {
	res := []T{}

	driver, err := directory.Neo4jClient(ctx)
	if err != nil {
		return res, err
	}

	session, err := driver.Session(neo4j.AccessModeRead)
	if err != nil {
		return res, err
	}
	defer session.Close()

	tx, err := session.BeginTransaction()
	if err != nil {
		return res, err
	}
	defer tx.Close()

	var r neo4j.Result
	if len(filter.NodeIds) == 0 {
		r, err = tx.Run(`
		MATCH (n:Node) RETURN n
		`, nil)
	} else {
		r, err = tx.Run(`
		MATCH (n:Node) WHERE n.node_id IN $ids RETURN n
		`, map[string]interface{}{"ids": filter.NodeIds})
	}

	if err != nil {
		return res, err
	}

	recs, err := r.Collect()

	if err != nil {
		return res, err
	}

	for _, rec := range recs {
		data, has := rec.Get("n")
		if !has {
			log.Warn().Msgf("Missing neo4j entry")
			continue
		}
		da, ok := data.(dbtype.Node)
		if !ok {
			log.Warn().Msgf("Missing neo4j entry")
			continue
		}
		var node T
		utils.FromMap(da.Props, &node)
		res = append(res, node)
	}

	return res, nil
}

func getHostContainers(ctx context.Context, host model.Host) ([]model.Container, error) {
	res := []model.Container{}

	driver, err := directory.Neo4jClient(ctx)
	if err != nil {
		return res, err
	}

	session, err := driver.Session(neo4j.AccessModeRead)
	if err != nil {
		return res, err
	}
	defer session.Close()

	tx, err := session.BeginTransaction()
	if err != nil {
		return res, err
	}
	defer tx.Close()

	r, err := tx.Run(`
		MATCH (n:Node) -[:HOSTS]-> (m:Container) WHERE n.node_id IN $ids RETURN m
		`, map[string]interface{}{"ids": []string{host.ID}})

	if err != nil {
		return res, err
	}

	recs, err := r.Collect()

	if err != nil {
		return res, err
	}

	for _, rec := range recs {
		data, has := rec.Get("m")
		if !has {
			log.Warn().Msgf("Missing neo4j entry")
			continue
		}
		da, ok := data.(dbtype.Node)
		if !ok {
			log.Warn().Msgf("Missing neo4j entry")
			continue
		}
		var node model.Container
		utils.FromMap(da.Props, &node)
		res = append(res, node)
	}

	return res, nil
}

func getHostProcesses(ctx context.Context, host model.Host) ([]model.Process, error) {
	res := []model.Process{}

	driver, err := directory.Neo4jClient(ctx)
	if err != nil {
		return res, err
	}

	session, err := driver.Session(neo4j.AccessModeRead)
	if err != nil {
		return res, err
	}
	defer session.Close()

	tx, err := session.BeginTransaction()
	if err != nil {
		return res, err
	}
	defer tx.Close()

	r, err := tx.Run(`
		MATCH (n:Node) -[:HOSTS]-> (m:Process) WHERE n.node_id IN $ids RETURN m
		`, map[string]interface{}{"ids": []string{host.ID}})

	if err != nil {
		return res, err
	}

	recs, err := r.Collect()

	if err != nil {
		return res, err
	}

	for _, rec := range recs {
		data, has := rec.Get("m")
		if !has {
			log.Warn().Msgf("Missing neo4j entry")
			continue
		}
		da, ok := data.(dbtype.Node)
		if !ok {
			log.Warn().Msgf("Missing neo4j entry")
			continue
		}
		var node model.Process
		utils.FromMap(da.Props, &node)
		res = append(res, node)
	}

	return res, nil
}

func getContainerProcesses(ctx context.Context, container model.Container) ([]model.Process, error) {
	res := []model.Process{}

	driver, err := directory.Neo4jClient(ctx)
	if err != nil {
		return res, err
	}

	session, err := driver.Session(neo4j.AccessModeRead)
	if err != nil {
		return res, err
	}
	defer session.Close()

	tx, err := session.BeginTransaction()
	if err != nil {
		return res, err
	}
	defer tx.Close()

	r, err := tx.Run(`
		MATCH (n:Node) -[:HOSTS]-> (m:Process) WHERE n.node_id IN $ids RETURN m
		`, map[string]interface{}{"ids": []string{container.ID}})

	if err != nil {
		return res, err
	}

	recs, err := r.Collect()

	if err != nil {
		return res, err
	}

	for _, rec := range recs {
		data, has := rec.Get("m")
		if !has {
			log.Warn().Msgf("Missing neo4j entry")
			continue
		}
		da, ok := data.(dbtype.Node)
		if !ok {
			log.Warn().Msgf("Missing neo4j entry")
			continue
		}
		var node model.Process
		utils.FromMap(da.Props, &node)
		res = append(res, node)
	}

	return res, nil
}
