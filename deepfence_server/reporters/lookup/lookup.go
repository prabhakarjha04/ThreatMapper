package reporters_lookup

import (
	"context"

	"github.com/deepfence/ThreatMapper/deepfence_server/model"
	"github.com/deepfence/ThreatMapper/deepfence_server/reporters"
	"github.com/deepfence/golang_deepfence_sdk/utils/directory"
	"github.com/deepfence/golang_deepfence_sdk/utils/utils"
	"github.com/neo4j/neo4j-go-driver/v4/neo4j"
	"github.com/neo4j/neo4j-go-driver/v4/neo4j/dbtype"
	"github.com/rs/zerolog/log"
)

// If no nodeIds are provided, will return all
// If no field are provided, will return all fields.
// (Fields can only be top level since neo4j does not support nested fields)
type LookupFilter struct {
	InFieldFilter []string          `json:"in_field_filter" required:"true"` // Fields to return
	NodeIds       []string          `json:"node_ids" required:"true"`        // Node to return
	Window        model.FetchWindow `json:"window" required:"true"`
}

func GetHostsReport(ctx context.Context, filter LookupFilter) ([]model.Host, error) {
	hosts, err := getGenericDirectNodeReport[model.Host](ctx, filter)
	if err != nil {
		return nil, err
	}

	getProcesses := false
	getContainerImages := false
	getContainers := false
	getPods := false
	if len(filter.InFieldFilter) == 0 {
		getProcesses = true
		getContainerImages = true
		getContainers = true
		getPods = true
	} else {
		getProcesses = utils.InSlice("processes", filter.InFieldFilter)
		getContainerImages = utils.InSlice("container_images", filter.InFieldFilter)
		getContainers = utils.InSlice("containers", filter.InFieldFilter)
		getPods = utils.InSlice("pods", filter.InFieldFilter)
	}

	for i := range hosts {
		if getProcesses == true {
			processes, err := getHostProcesses(ctx, hosts[i])
			if err == nil {
				hosts[i].Processes = processes
			}
		}

		if getContainers == true {
			containers, err := getHostContainers(ctx, hosts[i])
			if err == nil {
				hosts[i].Containers = containers
			}
		}

		if getContainerImages == true {
			containerImages, err := getHostContainerImages(ctx, hosts[i])
			if err == nil {
				hosts[i].ContainerImages = containerImages
			}
		}

		if getPods == true {
			pods, err := getHostPods(ctx, hosts[i])
			if err == nil {
				hosts[i].Pods = pods
			}
		}
	}
	return hosts, nil
}

func GetContainersReport(ctx context.Context, filter LookupFilter) ([]model.Container, error) {
	containers, err := getGenericDirectNodeReport[model.Container](ctx, filter)
	if err != nil {
		return nil, err
	}

	getProcesses := false
	getContainerImages := false
	if len(filter.InFieldFilter) == 0 {
		getProcesses = true
		getContainerImages = true
	} else {
		getProcesses = utils.InSlice("processes", filter.InFieldFilter)
		getContainerImages = utils.InSlice("image", filter.InFieldFilter)
	}

	for i := range containers {
		if getProcesses == true {
			processes, err := getContainerProcesses(ctx, containers[i])
			if err == nil {
				containers[i].Processes = processes
			}
		}
		if getContainerImages == true {
			images, err := getContainerContainerImages(ctx, containers[i])
			if err == nil && len(images) > 0 {
				containers[i].ContainerImage = images[0]
			}
		}
	}

	return containers, nil
}

func GetProcessesReport(ctx context.Context, filter LookupFilter) ([]model.Process, error) {
	processes, err := getGenericDirectNodeReport[model.Process](ctx, filter)
	if err != nil {
		return nil, err
	}
	return processes, nil
}

func GetPodsReport(ctx context.Context, filter LookupFilter) ([]model.Pod, error) {
	pods, err := getGenericDirectNodeReport[model.Pod](ctx, filter)
	if err != nil {
		return nil, err
	}
	return pods, nil
}

func GetContainerImagesReport(ctx context.Context, filter LookupFilter) ([]model.ContainerImage, error) {
	images, err := getGenericDirectNodeReport[model.ContainerImage](ctx, filter)
	if err != nil {
		return nil, err
	}

	getContainers := false
	if len(filter.InFieldFilter) == 0 {
		getContainers = true
	} else {
		getContainers = utils.InSlice("image", filter.InFieldFilter)
	}

	for i := range images {
		if getContainers == true {
			containers, err := getContainerImageContainers(ctx, images[i])
			if err == nil {
				images[i].Containers = containers
			}
		}
	}

	return images, nil
}

func GetKubernetesClustersReport(ctx context.Context, filter LookupFilter) ([]model.KubernetesCluster, error) {
	clusters, err := getGenericDirectNodeReport[model.KubernetesCluster](ctx, filter)
	if err != nil {
		return nil, err
	}

	getHosts := false
	if len(filter.InFieldFilter) == 0 {
		getHosts = true
	} else {
		getHosts = utils.InSlice("hosts", filter.InFieldFilter)
	}

	for i := range clusters {
		if getHosts == true {
			hosts, err := getClusterHosts(ctx, clusters[i])
			if err == nil {
				clusters[i].Hosts = hosts
			}
		}
	}

	return clusters, nil
}

func GetCloudResourcesReport(ctx context.Context, filter LookupFilter) ([]model.CloudResource, error) {
	entries, err := getGenericDirectNodeReport[model.CloudResource](ctx, filter)
	if err != nil {
		return nil, err
	}

	return entries, nil
}

func GetRegistryAccountReport(ctx context.Context, filter LookupFilter) ([]model.RegistryAccount, error) {
	registry, err := getGenericDirectNodeReport[model.RegistryAccount](ctx, filter)
	if err != nil {
		return nil, err
	}

	for i := range registry {
		container_images, err := getRegistryImages(ctx, registry[i])
		if err != nil {
			return nil, err
		}
		registry[i].ContainerImages = container_images
	}
	return registry, nil
}

func getGenericDirectNodeReport[T reporters.Cypherable](ctx context.Context, filter LookupFilter) ([]T, error) {
	res := []T{}
	var dummy T

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
	var query string
	if len(filter.NodeIds) == 0 {
		query = `
			MATCH (n:` + dummy.NodeType() + `)
			OPTIONAL MATCH (n) -[:IS]-> (e)
			RETURN ` + reporters.FieldFilterCypher("n", filter.InFieldFilter) + `, e`
	} else {
		query = `
			MATCH (n:` + dummy.NodeType() + `)
			WHERE n.node_id IN $ids
			OPTIONAL MATCH (n) -[:IS]-> (e)
			RETURN ` + reporters.FieldFilterCypher("n", filter.InFieldFilter) + `, e`
	}
	log.Info().Msgf("query: %s", query)
	r, err = tx.Run(query,
		map[string]interface{}{"ids": filter.NodeIds})

	if err != nil {
		return res, err
	}

	recs, err := r.Collect()

	if err != nil {
		return res, err
	}

	for _, rec := range recs {
		var node_map map[string]interface{}
		if len(filter.InFieldFilter) == 0 {
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
			node_map = da.Props
		} else {
			node_map = map[string]interface{}{}
			for i := range filter.InFieldFilter {
				node_map[filter.InFieldFilter[i]] = rec.Values[i]
			}
		}
		is_node, _ := rec.Get("e")
		if is_node != nil {
			for k, v := range is_node.(dbtype.Node).Props {
				if k != "node_id" {
					node_map[k] = v
				}
			}
		}
		var node T
		utils.FromMap(node_map, &node)
		res = append(res, node)
	}

	return res, nil
}

func getIndirectFromIDs[T any](ctx context.Context, query string, ids []string) ([]T, error) {
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

	r, err := tx.Run(query, map[string]interface{}{"ids": ids})

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
		var node T
		utils.FromMap(da.Props, &node)
		res = append(res, node)
	}

	return res, nil
}

func getHostContainers(ctx context.Context, host model.Host) ([]model.Container, error) {
	containers, err := getIndirectFromIDs[model.Container](ctx, `
		MATCH (n:Node) -[:HOSTS]-> (m:Container)
		WHERE n.node_id IN $ids
		RETURN m`,
		[]string{host.ID})
	if err != nil {
		return nil, err
	}
	return containers, err
}

func getHostPods(ctx context.Context, host model.Host) ([]model.Pod, error) {
	return getIndirectFromIDs[model.Pod](ctx, `
		MATCH (n:Node) -[:HOSTS]-> (m:Pod)
		WHERE n.node_id IN $ids
		RETURN m`,
		[]string{host.ID})
}

func getHostContainerImages(ctx context.Context, host model.Host) ([]model.ContainerImage, error) {
	return getIndirectFromIDs[model.ContainerImage](ctx, `
		MATCH (n:Node) -[:HOSTS]-> (m:ContainerImage)
		WHERE n.node_id IN $ids
		RETURN m`,
		[]string{host.ID})
}

func getRegistryImages(ctx context.Context, registry model.RegistryAccount) ([]model.ContainerImage, error) {
	return getIndirectFromIDs[model.ContainerImage](ctx, `
		MATCH (n:RegistryAccount) -[:HOSTS]-> (m:ContainerImage)
		WHERE n.node_id IN $ids
		RETURN m`,
		[]string{registry.ID})
}

func getHostProcesses(ctx context.Context, host model.Host) ([]model.Process, error) {
	return getIndirectFromIDs[model.Process](ctx, `
		MATCH (n:Node) -[:HOSTS]-> (m:Process)
		WHERE n.node_id IN $ids
		RETURN m`,
		[]string{host.ID})
}

func getContainerProcesses(ctx context.Context, container model.Container) ([]model.Process, error) {
	return getIndirectFromIDs[model.Process](ctx, `
		MATCH (n:Container) -[:HOSTS]-> (m:Process)
		WHERE n.node_id IN $ids
		RETURN m`,
		[]string{container.ID})
}

func getContainerContainerImages(ctx context.Context, container model.Container) ([]model.ContainerImage, error) {
	return getIndirectFromIDs[model.ContainerImage](ctx, `
		MATCH (n:Container) 
		WHERE n.node_id IN $ids
		MATCH (m:ContainerImage{node_id:n.docker_image_id})
		RETURN m`,
		[]string{container.ID})
}

func getContainerImageContainers(ctx context.Context, image model.ContainerImage) ([]model.Container, error) {
	return getIndirectFromIDs[model.Container](ctx, `
		MATCH (n:ContainerImage)
		WHERE n.node_id in $ids
		RETURN n`,
		[]string{image.ID})
}

func getClusterHosts(ctx context.Context, cluster model.KubernetesCluster) ([]model.Host, error) {
	return getIndirectFromIDs[model.Host](ctx, `
		MATCH (m:KubernetesCluster) -[:INSTANCIATE]-> (n:Node)
		WHERE m.node_id IN $ids
		RETURN n`,
		[]string{cluster.ID})
}
