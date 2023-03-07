import { useEffect } from 'react';
import { generatePath, LoaderFunctionArgs, useFetcher } from 'react-router-dom';

import { getSearchApiClient } from '@/api/api';
import {
  ApiDocsBadRequestResponse,
  ModelScanResultsActionRequestScanTypeEnum,
} from '@/api/generated';
import { ScanType } from '@/features/common/data-component/searchHostsApiLoader';
import { ApiError, makeRequest } from '@/utils/api';

export type ContainersListType = {
  nodeId: string;
  nodeName: string;
};

export const searchContainersApiLoader = async ({
  params,
}: LoaderFunctionArgs): Promise<ContainersListType[]> => {
  const scanType = params?.scanType;
  if (!scanType) {
    throw new Error('Scan For is required');
  }
  let filterValue = '';
  if (scanType === ModelScanResultsActionRequestScanTypeEnum.SecretScan) {
    filterValue = 'secrets_count';
  } else if (scanType === ModelScanResultsActionRequestScanTypeEnum.VulnerabilityScan) {
    filterValue = 'vulnerabilities_count';
  } else if (scanType === ModelScanResultsActionRequestScanTypeEnum.MalwareScan) {
    filterValue = 'malwares_count';
  } else if (scanType === ModelScanResultsActionRequestScanTypeEnum.ComplianceScan) {
    filterValue = 'compliances_count';
  }

  const result = await makeRequest({
    apiFunction: getSearchApiClient().searchContainers,
    apiArgs: [
      {
        searchSearchNodeReq: {
          node_filter: {
            filters: {
              contains_filter: {
                filter_in: {},
              },
              order_filter: {
                order_fields: [
                  {
                    field_name: filterValue,
                    descending: true,
                  },
                ],
              },
              match_filter: {
                filter_in: {},
              },
            },
            in_field_filter: null,
          },
          window: {
            offset: 0,
            size: 100,
          },
        },
      },
    ],
    errorHandler: async (r) => {
      const error = new ApiError<{
        message?: string;
      }>({});
      if (r.status === 400) {
        const modelResponse: ApiDocsBadRequestResponse = await r.json();
        return error.set({
          message: modelResponse.message,
        });
      }
    },
  });

  if (ApiError.isApiError(result)) {
    throw result.value();
  }

  if (result === null) {
    return [];
  }
  return result.map((res) => {
    return {
      nodeId: res.node_id,
      nodeName: res.docker_container_name,
    };
  });
};

export const useGetContainersList = ({
  scanType,
}: {
  scanType: ScanType;
}): {
  status: 'idle' | 'loading' | 'submitting';
  containers: ContainersListType[];
} => {
  const fetcher = useFetcher<ContainersListType[]>();

  useEffect(() => {
    fetcher.load(
      generatePath('/data-component/search/containers/:scanType', {
        scanType,
      }),
    );
  }, [scanType]);

  return {
    status: fetcher.state,
    containers: fetcher.data ?? [],
  };
};
