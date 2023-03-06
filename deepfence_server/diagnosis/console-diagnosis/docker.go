package console_diagnosis

import (
	"archive/tar"
	"archive/zip"
	"context"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/deepfence/golang_deepfence_sdk/utils/directory"
	"github.com/docker/docker/api/types"
	"github.com/docker/docker/api/types/filters"
	dockerClient "github.com/docker/docker/client"
	"github.com/minio/minio-go/v7"
	"github.com/rs/zerolog/log"
)

type DockerConsoleDiagnosisHandler struct {
	dockerCli *dockerClient.Client
}

func NewDockerConsoleDiagnosisHandler() (*DockerConsoleDiagnosisHandler, error) {
	var err error
	dockerCli, err := dockerClient.NewClientWithOpts(dockerClient.WithAPIVersionNegotiation())
	if err != nil {
		return nil, err
	}
	return &DockerConsoleDiagnosisHandler{dockerCli: dockerCli}, nil
}

func (d *DockerConsoleDiagnosisHandler) GenerateDiagnosticLogs(tail string) error {
	zipFile, err := CreateTempFile("deepfence-console-logs-*.zip")
	if err != nil {
		return err
	}
	defer func() {
		zipFile.Close()
		os.RemoveAll(zipFile.Name())
	}()
	zipWriter := zip.NewWriter(zipFile)
	ctx := context.Background()

	containerFilters := filters.NewArgs()
	containers := d.getContainers(ctx, types.ContainerListOptions{
		Filters: containerFilters,
		All:     true,
	})

	logOptions := types.ContainerLogsOptions{
		ShowStdout: true,
		ShowStderr: true,
		Tail:       tail,
	}

	for _, container := range containers {
		err = d.addContainerLogs(ctx, &container, logOptions, zipWriter)
		if err != nil {
			log.Warn().Msg(err.Error())
		}
	}
	err = zipWriter.Close()
	if err != nil {
		return err
	}
	zipWriter.Flush()

	mc, err := directory.MinioClient(ctx)
	if err != nil {
		return err
	}
	filePath := path.Join("/diagnosis/console-diagnosis", filepath.Base(zipFile.Name()))
	_, err = mc.UploadLocalFile(ctx, filePath, zipFile.Name(), minio.PutObjectOptions{ContentType: "application/zip"})
	if err != nil {
		return err
	}
	return nil
}

func (d *DockerConsoleDiagnosisHandler) addContainerLogs(ctx context.Context, container *types.Container, logOptions types.ContainerLogsOptions, zipWriter *zip.Writer) error {
	if len(container.Names) == 0 {
		return nil
	}
	containerName := strings.Trim(container.Names[0], "/")
	logs, err := d.getContainerLogs(ctx, container.ID, logOptions)
	if err != nil {
		return err
	}
	logBytes, err := io.ReadAll(logs)
	if err != nil {
		logs.Close()
		return err
	}
	logs.Close()
	zipFileWriter, err := zipWriter.Create(fmt.Sprintf("%s.log", containerName))
	if err != nil {
		return err
	}
	if _, err := zipFileWriter.Write(logBytes); err != nil {
		return err
	}
	if strings.Contains(containerName, "router") {
		err = d.CopyFromContainer(ctx, container.ID, containerName, HaproxyLogsPath, zipWriter)
		if err != nil {
			return err
		}
	}
	return nil
}

func (d *DockerConsoleDiagnosisHandler) getContainerLogs(ctx context.Context, containerID string, options types.ContainerLogsOptions) (io.ReadCloser, error) {
	logs, err := d.dockerCli.ContainerLogs(ctx, containerID, options)
	if err != nil {
		return nil, err
	}
	return logs, nil
}

func (d *DockerConsoleDiagnosisHandler) getContainers(ctx context.Context, options types.ContainerListOptions) []types.Container {
	containers, err := d.dockerCli.ContainerList(ctx, options)
	if err != nil {
		panic(err)
	}
	return containers
}

func (d *DockerConsoleDiagnosisHandler) CopyFromContainer(ctx context.Context, containerId string, containerName string, srcPath string, zipWriter *zip.Writer) error {

	tarStream, _, err := d.dockerCli.CopyFromContainer(ctx, containerId, srcPath)
	if err != nil {
		return err
	}
	tr := tar.NewReader(tarStream)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break // end of tar archive
		}
		if err != nil {
			return err
		}
		logBytes, err := io.ReadAll(tr)
		if err != nil {
			return err
		}
		if hdr.FileInfo().IsDir() {
			hdr.Name = containerName
		} else {
			hdr.Name = containerName + "/" + hdr.Name
		}
		zipFileWriter, err := zipWriter.Create(hdr.Name)
		if err != nil {
			return err
		}
		if _, err := zipFileWriter.Write(logBytes); err != nil {
			return err
		}
	}
	return nil
}