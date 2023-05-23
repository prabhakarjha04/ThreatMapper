import cx from 'classnames';
import { capitalize } from 'lodash-es';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FaHistory } from 'react-icons/fa';
import { FiFilter } from 'react-icons/fi';
import {
  HiArchive,
  HiBell,
  HiChevronLeft,
  HiChevronRight,
  HiDotsVertical,
  HiEye,
  HiEyeOff,
  HiOutlineDownload,
  HiOutlineExclamationCircle,
  HiOutlineTrash,
} from 'react-icons/hi';
import { IconContext } from 'react-icons/lib';
import {
  ActionFunctionArgs,
  generatePath,
  LoaderFunctionArgs,
  Outlet,
  useFetcher,
  useLoaderData,
  useSearchParams,
} from 'react-router-dom';
import { toast } from 'sonner';
import { twMerge } from 'tailwind-merge';
import {
  Badge,
  Breadcrumb,
  BreadcrumbLink,
  Button,
  Card,
  Checkbox,
  CircleSpinner,
  createColumnHelper,
  Dropdown,
  DropdownItem,
  DropdownSubMenu,
  getRowSelectionColumn,
  IconButton,
  Modal,
  Popover,
  RowSelectionState,
  Select,
  SelectItem,
  SortingState,
  Table,
  TableSkeleton,
} from 'ui-components';

import { getScanResultsApiClient, getSecretApiClient } from '@/api/api';
import {
  ApiDocsBadRequestResponse,
  ModelScanInfo,
  ModelScanResultsReq,
  UtilsReportFiltersNodeTypeEnum,
  UtilsReportFiltersScanTypeEnum,
} from '@/api/generated';
import { ModelSecret } from '@/api/generated/models/ModelSecret';
import { DFLink } from '@/components/DFLink';
import { FilterHeader } from '@/components/forms/FilterHeader';
import {
  HeaderSkeleton,
  RectSkeleton,
  SquareSkeleton,
  TimestampSkeleton,
} from '@/components/header/HeaderSkeleton';
import { ScanStatusBadge } from '@/components/ScanStatusBadge';
import {
  NoIssueFound,
  ScanStatusInError,
  ScanStatusInProgress,
} from '@/components/ScanStatusMessage';
import { SecretsIcon } from '@/components/sideNavigation/icons/Secrets';
import { SEVERITY_COLORS } from '@/constants/charts';
import { useDownloadScan } from '@/features/common/data-component/downloadScanAction';
import { ScanHistoryApiLoaderDataType } from '@/features/common/data-component/scanHistoryApiLoader';
import { SecretsResultChart } from '@/features/secrets/components/landing/SecretsResultChart';
import { SuccessModalContent } from '@/features/settings/components/SuccessModalContent';
import { Mode, useTheme } from '@/theme/ThemeContext';
import { ScanStatusEnum, ScanTypeEnum, SecretSeverityType } from '@/types/common';
import { ApiError, apiWrapper, makeRequest } from '@/utils/api';
import { formatMilliseconds } from '@/utils/date';
import { typedDefer, TypedDeferredData } from '@/utils/router';
import { isScanComplete, isScanFailed } from '@/utils/scan';
import { DFAwait } from '@/utils/suspense';
import {
  getOrderFromSearchParams,
  getPageFromSearchParams,
  useSortingState,
} from '@/utils/table';
import { usePageNavigation } from '@/utils/usePageNavigation';

export interface FocusableElement {
  focus(options?: FocusOptions): void;
}
enum ActionEnumType {
  MASK = 'mask',
  UNMASK = 'unmask',
  DELETE = 'delete',
  NOTIFY = 'notify',
  DELETE_SCAN = 'delete_scan',
}

type ScanResult = {
  totalSeverity: number;
  severityCounts: { [key: string]: number };
  timestamp: number;
  tableData: ModelSecret[];
  pagination: {
    currentPage: number;
    totalRows: number;
  };
};

export type LoaderDataType = {
  error?: string;
  scanStatusResult?: ModelScanInfo;
  message?: string;
  data?: ScanResult;
};

const PAGE_SIZE = 15;

const getSeveritySearch = (searchParams: URLSearchParams) => {
  return searchParams.getAll('severity');
};
const getMaskSearch = (searchParams: URLSearchParams) => {
  return searchParams.getAll('mask');
};
const getUnmaskSearch = (searchParams: URLSearchParams) => {
  return searchParams.getAll('unmask');
};

async function getScans(
  scanId: string,
  searchParams: URLSearchParams,
): Promise<LoaderDataType> {
  // status api
  const statusResult = await makeRequest({
    apiFunction: getSecretApiClient().statusSecretScan,
    apiArgs: [
      {
        modelScanStatusReq: {
          scan_ids: [scanId],
          bulk_scan_id: '',
        },
      },
    ],
    errorHandler: async (r) => {
      const error = new ApiError<LoaderDataType>({
        message: '',
      });
      if (r.status === 400) {
        const modelResponse: ApiDocsBadRequestResponse = await r.json();
        return error.set({
          message: modelResponse.message,
        });
      }
    },
  });

  if (ApiError.isApiError(statusResult)) {
    return statusResult.value();
  }

  if (!statusResult || !statusResult?.statuses?.[scanId]) {
    throw new Error('Scan status not found');
  }

  const scanStatus = statusResult?.statuses?.[scanId].status;

  const isScanRunning =
    scanStatus !== ScanStatusEnum.complete && scanStatus !== ScanStatusEnum.error;
  const isScanError = scanStatus === ScanStatusEnum.error;

  if (isScanRunning || isScanError) {
    return {
      scanStatusResult: statusResult.statuses[scanId],
    };
  }

  const severity = getSeveritySearch(searchParams);
  const page = getPageFromSearchParams(searchParams);
  const order = getOrderFromSearchParams(searchParams);

  const mask = getMaskSearch(searchParams);
  const unmask = getUnmaskSearch(searchParams);

  const scanResultsReq: ModelScanResultsReq = {
    fields_filter: {
      contains_filter: {
        filter_in: {},
      },
      match_filter: { filter_in: {} },
      order_filter: { order_fields: [] },
      compare_filter: null,
    },
    scan_id: scanId,
    window: {
      offset: page * PAGE_SIZE,
      size: PAGE_SIZE,
    },
  };

  if (severity.length) {
    scanResultsReq.fields_filter.contains_filter.filter_in!['level'] = severity;
  }

  if ((mask.length || unmask.length) && !(mask.length && unmask.length)) {
    scanResultsReq.fields_filter.contains_filter.filter_in!['masked'] = [
      mask.length ? true : false,
    ];
  }

  if (order) {
    scanResultsReq.fields_filter.order_filter.order_fields?.push({
      field_name: order.sortBy,
      descending: order.descending,
    });
  }

  const result = await makeRequest({
    apiFunction: getSecretApiClient().resultSecretScan,
    apiArgs: [{ modelScanResultsReq: scanResultsReq }],
  });

  if (ApiError.isApiError(result)) {
    throw result.value();
  }

  if (result === null) {
    // TODO: handle this case with 404 status maybe
    throw new Error('Error getting scan results');
  }
  const totalSeverity = Object.values(result.severity_counts ?? {}).reduce(
    (acc, value) => {
      acc = acc + value;
      return acc;
    },
    0,
  );

  const resultCounts = await makeRequest({
    apiFunction: getSecretApiClient().resultCountSecretScan,
    apiArgs: [
      {
        modelScanResultsReq: {
          ...scanResultsReq,
          window: {
            ...scanResultsReq.window,
            size: 10 * scanResultsReq.window.size,
          },
        },
      },
    ],
  });

  if (ApiError.isApiError(resultCounts)) {
    throw resultCounts.value();
  }

  return {
    scanStatusResult: statusResult.statuses[scanId],
    data: {
      totalSeverity,
      severityCounts: {
        critical: result.severity_counts?.['critical'] ?? 0,
        high: result.severity_counts?.['high'] ?? 0,
        medium: result.severity_counts?.['medium'] ?? 0,
        low: result.severity_counts?.['low'] ?? 0,
        unknown: result.severity_counts?.['unknown'] ?? 0,
      },
      timestamp: result.updated_at,
      tableData: result.secrets ?? [],
      pagination: {
        currentPage: page,
        totalRows: page * PAGE_SIZE + resultCounts.count,
      },
    },
  };
}

type ActionFunctionType =
  | ReturnType<typeof getScanResultsApiClient>['deleteScanResult']
  | ReturnType<typeof getScanResultsApiClient>['maskScanResult']
  | ReturnType<typeof getScanResultsApiClient>['notifyScanResult']
  | ReturnType<typeof getScanResultsApiClient>['unmaskScanResult'];

type ActionData = {
  success: boolean;
} | null;

const action = async ({
  params: { scanId = '' },
  request,
}: ActionFunctionArgs): Promise<ActionData> => {
  const formData = await request.formData();
  const ids = (formData.getAll('ids[]') ?? []) as string[];
  const actionType = formData.get('actionType');
  const _scanId = scanId;
  const mask = formData.get('maskHostAndImages');
  if (!_scanId) {
    throw new Error('Scan ID is required');
  }
  if (!actionType) {
    return null;
  }

  let result = null;
  let apiFunction: ActionFunctionType | null = null;
  if (actionType === ActionEnumType.DELETE || actionType === ActionEnumType.NOTIFY) {
    apiFunction =
      actionType === ActionEnumType.DELETE
        ? getScanResultsApiClient().deleteScanResult
        : getScanResultsApiClient().notifyScanResult;
    result = await makeRequest({
      apiFunction: apiFunction,
      apiArgs: [
        {
          modelScanResultsActionRequest: {
            result_ids: [...ids],
            scan_id: _scanId,
            scan_type: ScanTypeEnum.SecretScan,
          },
        },
      ],
      errorHandler: async (r) => {
        const error = new ApiError<{
          message?: string;
        }>({});
        if (r.status === 400 || r.status === 409) {
          const modelResponse: ApiDocsBadRequestResponse = await r.json();
          return error.set({
            message: modelResponse.message ?? '',
          });
        }
      },
    });
  } else if (actionType === ActionEnumType.MASK || actionType === ActionEnumType.UNMASK) {
    apiFunction =
      actionType === ActionEnumType.MASK
        ? getScanResultsApiClient().maskScanResult
        : getScanResultsApiClient().unmaskScanResult;
    result = await makeRequest({
      apiFunction: apiFunction,
      apiArgs: [
        {
          modelScanResultsMaskRequest: {
            mask_across_hosts_and_images: mask === 'maskHostAndImages',
            result_ids: [...ids],
            scan_id: _scanId,
            scan_type: ScanTypeEnum.SecretScan,
          },
        },
      ],
      errorHandler: async (r) => {
        const error = new ApiError<{
          message?: string;
        }>({});
        if (r.status === 400 || r.status === 409) {
          const modelResponse: ApiDocsBadRequestResponse = await r.json();
          return error.set({
            message: modelResponse.message ?? '',
          });
        }
      },
    });
  } else if (actionType === ActionEnumType.DELETE_SCAN) {
    const deleteScan = apiWrapper({
      fn: getScanResultsApiClient().deleteScanResultsForScanID,
    });

    const result = await deleteScan({
      scanId: formData.get('scanId') as string,
      scanType: ScanTypeEnum.SecretScan,
    });

    if (!result.ok) {
      throw new Error('Error deleting scan');
    }
  }

  if (ApiError.isApiError(result)) {
    if (result.value()?.message !== undefined) {
      const message = result.value()?.message ?? 'Something went wrong';
      toast.error(message);
    }
  }

  if (actionType === ActionEnumType.DELETE || actionType === ActionEnumType.DELETE_SCAN) {
    return {
      success: true,
    };
  } else if (actionType === ActionEnumType.NOTIFY) {
    toast.success('Notified successfully');
  } else if (actionType === ActionEnumType.MASK) {
    toast.success('Masked successfully');
  } else if (actionType === ActionEnumType.UNMASK) {
    toast.success('Unmasked successfully');
  }
  return null;
};

const loader = async ({
  params,
  request,
}: LoaderFunctionArgs): Promise<TypedDeferredData<LoaderDataType>> => {
  const scanId = params?.scanId ?? '';

  const searchParams = new URL(request.url).searchParams;

  return typedDefer({
    data: getScans(scanId, searchParams),
  });
};

const DeleteConfirmationModal = ({
  showDialog,
  ids,
  setShowDialog,
}: {
  showDialog: boolean;
  ids: string[];
  setShowDialog: React.Dispatch<React.SetStateAction<boolean>>;
}) => {
  const fetcher = useFetcher<ActionData>();

  const onDeleteAction = useCallback(
    (actionType: string) => {
      const formData = new FormData();
      formData.append('actionType', actionType);
      ids.forEach((item) => formData.append('ids[]', item));
      fetcher.submit(formData, {
        method: 'post',
      });
    },
    [ids, fetcher],
  );

  return (
    <Modal open={showDialog} onOpenChange={() => setShowDialog(false)}>
      {!fetcher.data?.success ? (
        <div className="grid place-items-center p-6">
          <IconContext.Provider
            value={{
              className: 'mb-3 dark:text-red-600 text-red-400 w-[70px] h-[70px]',
            }}
          >
            <HiOutlineExclamationCircle />
          </IconContext.Provider>
          <h3 className="mb-4 font-normal text-center text-sm">
            The selected secrets will be deleted.
            <br />
            <span>Are you sure you want to delete?</span>
          </h3>
          <div className="flex items-center justify-right gap-4">
            <Button size="xs" onClick={() => setShowDialog(false)} type="button" outline>
              No, Cancel
            </Button>
            <Button
              size="xs"
              color="danger"
              onClick={(e) => {
                e.preventDefault();
                onDeleteAction(ActionEnumType.DELETE);
              }}
            >
              Yes, I&apos;m sure
            </Button>
          </div>
        </div>
      ) : (
        <SuccessModalContent text="Deleted successfully!" />
      )}
    </Modal>
  );
};

const DeleteScanConfirmationModal = ({
  open,
  onOpenChange,
  scanId,
}: {
  scanId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const fetcher = useFetcher<ActionData>();
  const onDeleteScan = () => {
    const formData = new FormData();
    formData.append('actionType', ActionEnumType.DELETE_SCAN);
    formData.append('scanId', scanId);
    fetcher.submit(formData, {
      method: 'post',
    });
  };
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      {!fetcher.data?.success ? (
        <div className="grid place-items-center p-6">
          <IconContext.Provider
            value={{
              className: 'mb-3 dark:text-red-600 text-red-400 w-[70px] h-[70px]',
            }}
          >
            <HiOutlineExclamationCircle />
          </IconContext.Provider>
          <h3 className="mb-4 font-normal text-center text-sm">
            <span>Are you sure you want to delete the scan?</span>
          </h3>
          <div className="flex items-center justify-right gap-4">
            <Button size="xs" onClick={() => onOpenChange(false)} type="button" outline>
              No, Cancel
            </Button>
            <Button
              loading={fetcher.state === 'loading'}
              disabled={fetcher.state === 'loading'}
              size="xs"
              color="danger"
              onClick={(e) => {
                e.preventDefault();
                onDeleteScan();
              }}
            >
              Yes, I&apos;m sure
            </Button>
          </div>
        </div>
      ) : (
        <SuccessModalContent text="Scan deleted successfully!" />
      )}
    </Modal>
  );
};

const HistoryDropdown = ({ nodeType }: { nodeType: string }) => {
  const { navigate } = usePageNavigation();
  const fetcher = useFetcher<ScanHistoryApiLoaderDataType>();
  const loaderData = useLoaderData() as LoaderDataType;
  const isScanHistoryLoading = fetcher.state === 'loading';
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [scanIdToDelete, setScanIdToDelete] = useState<string | null>(null);
  const { downloadScan } = useDownloadScan();

  const onHistoryClick = (nodeType: string, nodeId: string) => {
    fetcher.load(
      generatePath('/data-component/scan-history/:scanType/:nodeType/:nodeId', {
        nodeId: nodeId,
        nodeType: nodeType,
        scanType: ScanTypeEnum.SecretScan,
      }),
    );
  };

  return (
    <>
      <Suspense
        fallback={
          <Button
            size="xs"
            color="primary"
            outline
            className="rounded-lg bg-transparent"
            startIcon={<FaHistory />}
            type="button"
            loading
          >
            Scan History
          </Button>
        }
      >
        <DFAwait resolve={loaderData.data ?? []}>
          {(resolvedData: LoaderDataType) => {
            const { scanStatusResult } = resolvedData;
            const { scan_id, node_id, node_type } = scanStatusResult ?? {};
            if (!scan_id || !node_id || !node_type) {
              throw new Error('Scan id, node id or node type is missing');
            }

            return (
              <Popover
                open={popoverOpen}
                triggerAsChild
                onOpenChange={(open) => {
                  if (open) onHistoryClick(node_type, node_id);
                  setPopoverOpen(open);
                }}
                content={
                  <div className="p-4 max-h-80 overflow-y-auto flex flex-col gap-2">
                    {fetcher.state === 'loading' && !fetcher.data?.data?.length && (
                      <div className="flex items-center justify-center p-4">
                        <CircleSpinner size="lg" />
                      </div>
                    )}
                    {[...(fetcher?.data?.data ?? [])].reverse().map((item) => {
                      const isCurrentScan = item.scanId === scan_id;
                      return (
                        <div key={item.scanId} className="flex gap-2 justify-between">
                          <button
                            className="flex gap-2 justify-between flex-grow"
                            onClick={() => {
                              navigate(
                                generatePath('/secret/scan-results/:scanId', {
                                  scanId: item.scanId,
                                }),
                                {
                                  replace: true,
                                },
                              );
                              setPopoverOpen(false);
                            }}
                          >
                            <span
                              className={twMerge(
                                cx(
                                  'flex items-center text-gray-700 dark:text-gray-400 gap-x-4',
                                  {
                                    'text-blue-600 dark:text-blue-500': isCurrentScan,
                                  },
                                ),
                              )}
                            >
                              {formatMilliseconds(item.updatedAt)}
                            </span>
                            <ScanStatusBadge status={item.status} />
                          </button>
                          <div className="flex gap-1">
                            <IconButton
                              color="primary"
                              outline
                              size="xxs"
                              disabled={!isScanComplete(item.status)}
                              className="rounded-lg bg-transparent"
                              icon={<HiOutlineDownload />}
                              onClick={(e) => {
                                e.preventDefault();
                                downloadScan({
                                  scanId: item.scanId,
                                  scanType: UtilsReportFiltersScanTypeEnum.Secret,
                                  nodeType: nodeType as UtilsReportFiltersNodeTypeEnum,
                                });
                              }}
                            />
                            <IconButton
                              color="danger"
                              outline
                              size="xxs"
                              disabled={
                                isCurrentScan ||
                                !isScanComplete(item.status) ||
                                !isScanFailed(item.status)
                              }
                              className="rounded-lg bg-transparent"
                              icon={<HiOutlineTrash />}
                              onClick={(e) => {
                                e.preventDefault();
                                setScanIdToDelete(item.scanId);
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                }
              >
                <Button
                  size="xs"
                  color="primary"
                  outline
                  startIcon={<FaHistory />}
                  type="button"
                  loading={isScanHistoryLoading}
                >
                  Scan History
                </Button>
              </Popover>
            );
          }}
        </DFAwait>
      </Suspense>
      {scanIdToDelete && (
        <DeleteScanConfirmationModal
          scanId={scanIdToDelete}
          open={!!scanIdToDelete}
          onOpenChange={(open) => {
            if (!open) setScanIdToDelete(null);
          }}
        />
      )}
    </>
  );
};

const ActionDropdown = ({
  ids,
  align,
  triggerButton,
  setIdsToDelete,
  setShowDeleteDialog,
}: {
  ids: string[];
  align: 'center' | 'end' | 'start';
  triggerButton: React.ReactNode;
  setIdsToDelete: React.Dispatch<React.SetStateAction<string[]>>;
  setShowDeleteDialog: React.Dispatch<React.SetStateAction<boolean>>;
}) => {
  const fetcher = useFetcher();

  const onTableAction = useCallback(
    (actionType: string, maskHostAndImages?: string) => {
      const formData = new FormData();
      formData.append('actionType', actionType);

      if (actionType === ActionEnumType.MASK || actionType === ActionEnumType.UNMASK) {
        formData.append('maskHostAndImages', maskHostAndImages ?? '');
      }

      ids.forEach((item) => formData.append('ids[]', item));
      fetcher.submit(formData, {
        method: 'post',
      });
    },
    [ids],
  );

  return (
    <>
      <Dropdown
        triggerAsChild={true}
        align={align}
        content={
          <>
            <DropdownSubMenu
              triggerAsChild
              content={
                <>
                  <DropdownItem onClick={() => onTableAction(ActionEnumType.MASK, '')}>
                    <IconContext.Provider
                      value={{ className: 'text-gray-700 dark:text-gray-400' }}
                    >
                      <HiEyeOff />
                    </IconContext.Provider>
                    Mask secret
                  </DropdownItem>
                  <DropdownItem
                    onClick={() =>
                      onTableAction(ActionEnumType.MASK, 'maskHostAndImages')
                    }
                  >
                    <IconContext.Provider
                      value={{ className: 'text-gray-700 dark:text-gray-400' }}
                    >
                      <HiEyeOff />
                    </IconContext.Provider>
                    Mask secret across hosts and images
                  </DropdownItem>
                </>
              }
            >
              <DropdownItem>
                {align === 'start' ? (
                  <>
                    <IconContext.Provider
                      value={{ className: 'w-3 h-3 text-gray-700 dark:text-gray-400' }}
                    >
                      <HiEyeOff />
                    </IconContext.Provider>
                    <span className="text-gray-700 dark:text-gray-400">Mask</span>
                    <IconContext.Provider
                      value={{
                        className: 'w-4 h-4 ml-auto',
                      }}
                    >
                      <HiChevronRight />
                    </IconContext.Provider>
                  </>
                ) : (
                  <>
                    <IconContext.Provider
                      value={{
                        className: 'w-4 h-4',
                      }}
                    >
                      <HiChevronLeft />
                    </IconContext.Provider>
                    <span className="text-gray-700 dark:text-gray-400">Mask</span>
                  </>
                )}
              </DropdownItem>
            </DropdownSubMenu>
            <DropdownSubMenu
              triggerAsChild
              content={
                <>
                  <DropdownItem onClick={() => onTableAction(ActionEnumType.UNMASK, '')}>
                    <IconContext.Provider
                      value={{ className: 'text-gray-700 dark:text-gray-400' }}
                    >
                      <HiEye />
                    </IconContext.Provider>
                    Un mask secret
                  </DropdownItem>
                  <DropdownItem
                    onClick={() =>
                      onTableAction(ActionEnumType.UNMASK, 'maskHostAndImages')
                    }
                  >
                    <IconContext.Provider
                      value={{ className: 'text-gray-700 dark:text-gray-400' }}
                    >
                      <HiEye />
                    </IconContext.Provider>
                    Un mask secret across hosts and images
                  </DropdownItem>
                </>
              }
            >
              <DropdownItem>
                {align === 'start' ? (
                  <>
                    <IconContext.Provider
                      value={{ className: 'w-3 h-3 text-gray-700 dark:text-gray-400' }}
                    >
                      <HiEye />
                    </IconContext.Provider>
                    <span className="text-gray-700 dark:text-gray-400">Un mask</span>
                    <IconContext.Provider
                      value={{
                        className: 'w-4 h-4 ml-auto',
                      }}
                    >
                      <HiChevronRight />
                    </IconContext.Provider>
                  </>
                ) : (
                  <>
                    <IconContext.Provider
                      value={{
                        className: 'w-4 h-4',
                      }}
                    >
                      <HiChevronLeft />
                    </IconContext.Provider>
                    <span className="text-gray-700 dark:text-gray-400">Un Mask</span>
                  </>
                )}
              </DropdownItem>
            </DropdownSubMenu>
            <DropdownItem
              className="text-sm"
              onClick={() => onTableAction(ActionEnumType.NOTIFY)}
            >
              <span className="flex items-center gap-x-2 text-gray-700 dark:text-gray-400">
                <IconContext.Provider
                  value={{ className: 'text-gray-700 dark:text-gray-400' }}
                >
                  <HiBell />
                </IconContext.Provider>
                Notify
              </span>
            </DropdownItem>
            <DropdownItem
              className="text-sm"
              onClick={() => {
                setIdsToDelete(ids);
                setShowDeleteDialog(true);
              }}
            >
              <span className="flex items-center gap-x-2 text-red-700 dark:text-red-400">
                <IconContext.Provider
                  value={{ className: 'text-red-700 dark:text-red-400' }}
                >
                  <HiArchive />
                </IconContext.Provider>
                Delete
              </span>
            </DropdownItem>
          </>
        }
      >
        {triggerButton}
      </Dropdown>
    </>
  );
};
const SecretTable = () => {
  const fetcher = useFetcher();
  const loaderData = useLoaderData() as LoaderDataType;
  const columnHelper = createColumnHelper<ModelSecret>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [rowSelectionState, setRowSelectionState] = useState<RowSelectionState>({});
  const [sort, setSort] = useSortingState();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [idsToDelete, setIdsToDelete] = useState<string[]>([]);
  useEffect(() => {
    if (idsToDelete.length) {
      setRowSelectionState({});
    }
  }, [loaderData.data]);
  const columns = useMemo(() => {
    const columns = [
      getRowSelectionColumn(columnHelper, {
        size: 20,
        minSize: 20,
        maxSize: 50,
      }),
      columnHelper.accessor('node_id', {
        cell: (info) => (
          <DFLink
            to={{
              pathname: `./${info.getValue()}`,
              search: searchParams.toString(),
            }}
            className="flex items-center gap-x-2"
          >
            <div className="p-1.5 bg-gray-100 shrink-0 dark:bg-gray-500/10 rounded-lg">
              <div className="w-4 h-4">
                <SecretsIcon />
              </div>
            </div>
            <div className="truncate">{info.getValue()}</div>
          </DFLink>
        ),
        header: () => 'ID',
        minSize: 50,
        size: 60,
        maxSize: 65,
      }),
      columnHelper.accessor('full_filename', {
        cell: (info) => info.getValue(),
        header: () => 'Filename',
        minSize: 80,
        size: 90,
        maxSize: 110,
      }),
      columnHelper.accessor('matched_content', {
        cell: (info) => info.getValue(),
        header: () => 'Matched Content',
        minSize: 50,
        size: 60,
        maxSize: 65,
      }),
      columnHelper.accessor('level', {
        cell: (info) => (
          <Badge
            label={info.getValue().toUpperCase()}
            className={cx({
              'bg-[#de425b]/20 dark:bg-[#de425b]/20 text-[#de425b] dark:text-[#de425b]':
                info.getValue().toLowerCase() === 'critical',
              'bg-[#f58055]/20 dark:bg-[#f58055/20 text-[#f58055] dark:text-[#f58055]':
                info.getValue().toLowerCase() === 'high',
              'bg-[#ffd577]/30 dark:bg-[##ffd577]/10 text-yellow-400 dark:text-[#ffd577]':
                info.getValue().toLowerCase() === 'medium',
              'bg-[#d6e184]/20 dark:bg-[#d6e184]/10 text-yellow-300 dark:text-[#d6e184]':
                info.getValue().toLowerCase() === 'low',
              'bg-[#9CA3AF]/10 dark:bg-[#9CA3AF]/10 text-gray-400 dark:text-[#9CA3AF]':
                info.getValue().toLowerCase() === 'unknown',
            })}
            size="sm"
          />
        ),
        header: () => 'Severity',
        minSize: 30,
        size: 40,
        maxSize: 65,
      }),
      columnHelper.accessor('name', {
        enableSorting: false,
        cell: (info) => {
          return info.getValue();
        },
        header: () => 'Rule Name',
        minSize: 80,
        size: 90,
        maxSize: 110,
      }),
      columnHelper.accessor('signature_to_match', {
        enableSorting: false,
        cell: (info) => {
          return info.getValue() || 'unknown';
        },
        header: () => 'Signature to match',
        minSize: 70,
        size: 80,
        maxSize: 100,
      }),
      columnHelper.display({
        id: 'actions',
        enableSorting: false,
        cell: (cell) => (
          <ActionDropdown
            ids={[cell.row.original.node_id.toString()]}
            align="end"
            setIdsToDelete={setIdsToDelete}
            setShowDeleteDialog={setShowDeleteDialog}
            triggerButton={
              <Button size="xs" color="normal">
                <IconContext.Provider
                  value={{ className: 'text-gray-700 dark:text-gray-400' }}
                >
                  <HiDotsVertical />
                </IconContext.Provider>
              </Button>
            }
          />
        ),
        header: () => '',
        minSize: 20,
        size: 20,
        maxSize: 20,
        enableResizing: false,
      }),
    ];

    return columns;
  }, [setSearchParams]);

  const selectedIds = useMemo(() => {
    return Object.keys(rowSelectionState).map((key) => key.split('<-->')[0]);
  }, [rowSelectionState]);

  return (
    <div className="self-start">
      <Suspense fallback={<TableSkeleton columns={6} rows={10} size={'md'} />}>
        <DFAwait resolve={loaderData.data}>
          {(resolvedData: LoaderDataType) => {
            const { data, scanStatusResult } = resolvedData;

            if (scanStatusResult?.status === ScanStatusEnum.error) {
              return <ScanStatusInError />;
            } else if (
              scanStatusResult?.status !== ScanStatusEnum.error &&
              scanStatusResult?.status !== ScanStatusEnum.complete
            ) {
              return <ScanStatusInProgress LogoIcon={SecretsIcon} />;
            } else if (
              scanStatusResult?.status === ScanStatusEnum.complete &&
              data &&
              data.pagination.currentPage === 0 &&
              data.tableData.length === 0
            ) {
              return (
                <NoIssueFound LogoIcon={SecretsIcon} scanType={ScanTypeEnum.SecretScan} />
              );
            }

            if (!data) {
              return null;
            }
            return (
              <>
                {selectedIds.length === 0 ? (
                  <div className="text-sm text-gray-400 font-medium py-1.5">
                    No rows selected
                  </div>
                ) : (
                  <div className="mb-1.5">
                    <ActionDropdown
                      ids={selectedIds}
                      align="start"
                      setIdsToDelete={setIdsToDelete}
                      setShowDeleteDialog={setShowDeleteDialog}
                      triggerButton={
                        <Button size="xxs" color="primary" outline>
                          Actions
                        </Button>
                      }
                    />
                  </div>
                )}
                {showDeleteDialog && (
                  <DeleteConfirmationModal
                    showDialog={showDeleteDialog}
                    ids={idsToDelete}
                    setShowDialog={setShowDeleteDialog}
                  />
                )}
                <Table
                  size="sm"
                  data={data.tableData}
                  columns={columns}
                  enableRowSelection
                  rowSelectionState={rowSelectionState}
                  onRowSelectionChange={setRowSelectionState}
                  enablePagination
                  manualPagination
                  enableColumnResizing
                  approximatePagination
                  totalRows={data.pagination.totalRows}
                  pageSize={PAGE_SIZE}
                  pageIndex={data.pagination.currentPage}
                  getRowId={(row) => `${row.node_id}`}
                  enableSorting
                  manualSorting
                  sortingState={sort}
                  onSortingChange={(updaterOrValue) => {
                    let newSortState: SortingState = [];
                    if (typeof updaterOrValue === 'function') {
                      newSortState = updaterOrValue(sort);
                    } else {
                      newSortState = updaterOrValue;
                    }
                    setSearchParams((prev) => {
                      if (!newSortState.length) {
                        prev.delete('sortby');
                        prev.delete('desc');
                      } else {
                        prev.set('sortby', String(newSortState[0].id));
                        prev.set('desc', String(newSortState[0].desc));
                      }
                      return prev;
                    });
                    setSort(newSortState);
                  }}
                  onPaginationChange={(updaterOrValue) => {
                    let newPageIndex = 0;
                    if (typeof updaterOrValue === 'function') {
                      newPageIndex = updaterOrValue({
                        pageIndex: data.pagination.currentPage,
                        pageSize: PAGE_SIZE,
                      }).pageIndex;
                    } else {
                      newPageIndex = updaterOrValue.pageIndex;
                    }
                    setSearchParams((prev) => {
                      prev.set('page', String(newPageIndex));
                      return prev;
                    });
                  }}
                  getTrProps={(row) => {
                    if (row.original.masked) {
                      return {
                        className: 'opacity-40',
                      };
                    }
                    return {};
                  }}
                />
              </>
            );
          }}
        </DFAwait>
      </Suspense>
    </div>
  );
};

const HeaderComponent = ({
  elementToFocusOnClose,
}: {
  elementToFocusOnClose: React.MutableRefObject<null>;
}) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const loaderData = useLoaderData() as LoaderDataType;
  const isFilterApplied =
    searchParams.has('severity') ||
    searchParams.has('mask') ||
    searchParams.has('unmask');

  const onResetFilters = () => {
    setSearchParams(() => {
      return {};
    });
  };

  return (
    <div className="flex p-1 pl-2 w-full items-center shadow bg-white dark:bg-gray-800">
      <Suspense
        fallback={
          <HeaderSkeleton
            RightSkeleton={
              <>
                <TimestampSkeleton />
                <SquareSkeleton />
                <SquareSkeleton />
              </>
            }
            LeftSkeleton={
              <>
                <RectSkeleton width="w-40" height="h-4" />
                <RectSkeleton width="w-40" height="h-4" />
                <RectSkeleton width="w-40" height="h-4" />
              </>
            }
          />
        }
      >
        <DFAwait resolve={loaderData.data ?? []}>
          {(resolvedData: LoaderDataType) => {
            const { scanStatusResult } = resolvedData;

            const { scan_id, node_type, updated_at, node_name } = scanStatusResult ?? {};

            if (!scan_id || !node_type || !updated_at) {
              throw new Error('Scan id, node type or updated_at is missing');
            }

            return (
              <>
                <Breadcrumb separator={<HiChevronRight />} transparent>
                  <BreadcrumbLink>
                    <DFLink to={'/secret'}>Secrets</DFLink>
                  </BreadcrumbLink>
                  <BreadcrumbLink>
                    <DFLink to={`/secret/scans?nodeType=${node_type}`}>
                      {capitalize(node_type)}
                    </DFLink>
                  </BreadcrumbLink>
                  <BreadcrumbLink>
                    <span className="inherit cursor-auto">{node_name}</span>
                  </BreadcrumbLink>
                </Breadcrumb>
                <div className="ml-auto flex items-center gap-x-4">
                  <div className="flex flex-col">
                    <span className="text-xs text-gray-500 dark:text-gray-200">
                      {formatMilliseconds(updated_at)}
                    </span>
                    <span className="text-gray-400 text-[10px]">Last scan</span>
                  </div>
                  <div className="ml-auto">
                    <HistoryDropdown nodeType={node_type} />
                  </div>

                  <div className="relative">
                    {isFilterApplied && (
                      <span className="absolute left-0 top-0 inline-flex h-2 w-2 rounded-full bg-blue-400 opacity-75"></span>
                    )}
                    <Popover
                      triggerAsChild
                      elementToFocusOnCloseRef={elementToFocusOnClose}
                      content={
                        <div className="ml-auto w-[300px]">
                          <div className="dark:text-white">
                            <FilterHeader onReset={onResetFilters} />
                            <div className="flex flex-col gap-y-6  p-4">
                              <fieldset>
                                <legend className="text-sm font-medium">
                                  Mask And Unmask
                                </legend>
                                <div className="flex gap-x-4 mt-1">
                                  <Checkbox
                                    label="Mask"
                                    checked={searchParams.getAll('mask').includes('true')}
                                    onCheckedChange={(state) => {
                                      if (state) {
                                        setSearchParams((prev) => {
                                          prev.append('mask', 'true');
                                          prev.delete('page');
                                          return prev;
                                        });
                                      } else {
                                        setSearchParams((prev) => {
                                          const prevStatuses = prev.getAll('mask');
                                          prev.delete('mask');
                                          prevStatuses
                                            .filter((mask) => mask !== 'true')
                                            .forEach((mask) => {
                                              prev.append('mask', mask);
                                            });
                                          prev.delete('mask');
                                          prev.delete('page');
                                          return prev;
                                        });
                                      }
                                    }}
                                  />
                                  <Checkbox
                                    label="Unmask"
                                    checked={searchParams
                                      .getAll('unmask')
                                      .includes('true')}
                                    onCheckedChange={(state) => {
                                      if (state) {
                                        setSearchParams((prev) => {
                                          prev.append('unmask', 'true');
                                          prev.delete('page');
                                          return prev;
                                        });
                                      } else {
                                        setSearchParams((prev) => {
                                          const prevStatuses = prev.getAll('unmask');
                                          prev.delete('unmask');
                                          prevStatuses
                                            .filter((status) => status !== 'true')
                                            .forEach((status) => {
                                              prev.append('unmask', status);
                                            });
                                          prev.delete('unmask');
                                          prev.delete('page');
                                          return prev;
                                        });
                                      }
                                    }}
                                  />
                                </div>
                              </fieldset>
                              <fieldset>
                                <Select
                                  noPortal
                                  name="severity"
                                  label={'Severity'}
                                  placeholder="Select Severity"
                                  value={searchParams.getAll('severity')}
                                  sizing="xs"
                                  onChange={(value) => {
                                    setSearchParams((prev) => {
                                      prev.delete('severity');
                                      value.forEach((severity) => {
                                        prev.append('severity', severity);
                                      });
                                      prev.delete('page');
                                      return prev;
                                    });
                                  }}
                                >
                                  {['critical', 'high', 'medium', 'low', 'unknown'].map(
                                    (severity: string) => {
                                      return (
                                        <SelectItem value={severity} key={severity}>
                                          {capitalize(severity)}
                                        </SelectItem>
                                      );
                                    },
                                  )}
                                </Select>
                              </fieldset>
                            </div>
                          </div>
                        </div>
                      }
                    >
                      <IconButton
                        size="xs"
                        outline
                        color="primary"
                        className="rounded-lg bg-transparent"
                        icon={<FiFilter />}
                      />
                    </Popover>
                  </div>
                </div>
              </>
            );
          }}
        </DFAwait>
      </Suspense>
    </div>
  );
};
const SeverityCountComponent = ({ theme }: { theme: Mode }) => {
  const loaderData = useLoaderData() as LoaderDataType;
  return (
    <Card className="p-4 grid grid-flow-row-dense gap-y-8">
      <Suspense
        fallback={
          <div className="min-h-[300px] flex items-center justify-center">
            <CircleSpinner size="md" />
          </div>
        }
      >
        <DFAwait resolve={loaderData.data}>
          {(resolvedData: LoaderDataType) => {
            const { data } = resolvedData;
            const severityCounts = data?.severityCounts ?? {};
            return (
              <>
                <div className="grid grid-flow-col-dense gap-x-4">
                  <div className="bg-red-100 dark:bg-red-500/10 rounded-lg flex items-center justify-center">
                    <div className="w-14 h-14 text-red-500 dark:text-red-400">
                      <SecretsIcon />
                    </div>
                  </div>
                  <div>
                    <h4 className="text-md font-semibold text-gray-900 dark:text-gray-200 tracking-wider">
                      Total Secrets
                    </h4>
                    <div className="mt-2">
                      <span className="text-2xl text-gray-900 dark:text-gray-200">
                        {data?.totalSeverity}
                      </span>
                      <h5 className="text-xs text-gray-500 dark:text-gray-200 mb-2">
                        Total count
                      </h5>
                      <div>
                        <span className="text-sm text-gray-900 dark:text-gray-200">
                          {0}
                        </span>
                        <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                          Active containers
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="min-h-[220px]">
                  <SecretsResultChart theme={theme} data={severityCounts} />
                </div>
                <div>
                  {Object.keys(severityCounts)?.map((key: string) => {
                    return (
                      <div key={key} className="flex items-center gap-2 p-1">
                        <div
                          className={cx('h-3 w-3 rounded-full')}
                          style={{
                            backgroundColor:
                              SEVERITY_COLORS[key.toLowerCase() as SecretSeverityType],
                          }}
                        />
                        <span className="text-sm text-gray-500 dark:text-gray-200">
                          {capitalize(key)}
                        </span>
                        <span
                          className={cx(
                            'text-sm text-gray-900 dark:text-gray-200 ml-auto tabular-nums',
                          )}
                        >
                          {severityCounts[key]}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            );
          }}
        </DFAwait>
      </Suspense>
    </Card>
  );
};
const SecretScanResults = () => {
  const elementToFocusOnClose = useRef(null);
  const { mode } = useTheme();

  return (
    <>
      <HeaderComponent elementToFocusOnClose={elementToFocusOnClose} />
      <div className="grid grid-cols-[400px_1fr] p-2 gap-x-2">
        <div className="self-start grid gap-y-2">
          <SeverityCountComponent theme={mode} />
        </div>
        <SecretTable />
      </div>
      <Outlet />
    </>
  );
};

export const module = {
  loader,
  action,
  element: <SecretScanResults />,
};
