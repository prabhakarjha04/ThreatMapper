import { useSuspenseQuery } from '@suspensive/react-query';
import cx from 'classnames';
import { Suspense, useCallback, useMemo, useState } from 'react';
import { IconContext } from 'react-icons';
import { FaUserPlus } from 'react-icons/fa';
import {
  HiCheck,
  HiOutlineEye,
  HiOutlineEyeOff,
  HiOutlineKey,
  HiOutlineMail,
  HiOutlineSupport,
  HiOutlineUser,
  HiUsers,
} from 'react-icons/hi';
import { MdCopyAll } from 'react-icons/md';
import { ActionFunctionArgs, useFetcher } from 'react-router-dom';
import { toast } from 'sonner';
import { twMerge } from 'tailwind-merge';
import {
  Button,
  createColumnHelper,
  Dropdown,
  DropdownItem,
  IconButton,
  Listbox,
  ListboxOption,
  Modal,
  SlidingModal,
  SlidingModalCloseButton,
  SlidingModalContent,
  SlidingModalHeader,
  Table,
  TableSkeleton,
  TextInput,
} from 'ui-components';

import { getUserApiClient } from '@/api/api';
import {
  ApiDocsBadRequestResponse,
  ModelInviteUserRequestActionEnum,
  ModelUpdateUserIdRequestRoleEnum,
} from '@/api/generated';
import { ModelUser } from '@/api/generated/models/ModelUser';
import { useCopyToClipboardState } from '@/components/CopyToClipboard';
import { EllipsisIcon } from '@/components/icons/common/Ellipsis';
import { ErrorStandardLineIcon } from '@/components/icons/common/ErrorStandardLine';
import { useGetApiToken } from '@/features/common/data-component/getApiTokenApiLoader';
import { useGetCurrentUser } from '@/features/common/data-component/getUserApiLoader';
import { ChangePassword } from '@/features/settings/components/ChangePassword';
import { SuccessModalContent } from '@/features/settings/components/SuccessModalContent';
import { invalidateQueries, queries } from '@/queries';
import { apiWrapper } from '@/utils/api';

export type ActionReturnType = {
  message?: string;
  fieldErrors?: {
    old_password?: string;
    new_password?: string;
    confirm_password?: string;
    email?: string;
    role?: string;
    firstName?: string;
    lastName?: string;
    status?: string;
  };
  success: boolean;
  invite_url?: string;
  invite_expiry_hours?: number;
  successMessage?: string;
};

export enum ActionEnumType {
  DELETE = 'delete',
  CHANGE_PASSWORD = 'changePassword',
  INVITE_USER = 'inviteUser',
  EDIT_USER = 'editUser',
}

const useListUsers = () => {
  return useSuspenseQuery({
    ...queries.setting.listUsers(),
  });
};

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<ActionReturnType> => {
  const formData = await request.formData();

  const _actionType = formData.get('_actionType')?.toString();

  if (!_actionType) {
    return {
      message: 'Action Type is required',
      success: false,
    };
  }

  if (_actionType === ActionEnumType.DELETE) {
    const id = Number(formData.get('userId'));
    const deleteApi = apiWrapper({
      fn: getUserApiClient().deleteUser,
    });
    const deleteResponse = await deleteApi({
      id,
    });
    if (!deleteResponse.ok) {
      if (deleteResponse.error.response.status === 400) {
        return {
          success: false,
          message: deleteResponse.error.message,
        };
      } else if (deleteResponse.error.response.status === 403) {
        return {
          success: false,
          message: 'You do not have enough permissions to delete user',
        };
      }
      throw deleteResponse.error;
    }

    return {
      success: true,
    };
  } else if (_actionType === ActionEnumType.CHANGE_PASSWORD) {
    // add console_url which is the origin of request
    formData.append('consoleUrl', window.location.origin);
    const body = Object.fromEntries(formData);

    if (body.new_password !== body.confirm_password) {
      return {
        message: 'Password does not match',
        success: false,
      };
    }

    const updateApi = apiWrapper({
      fn: getUserApiClient().updatePassword,
    });
    const updateResponse = await updateApi({
      modelUpdateUserPasswordRequest: {
        old_password: body.old_password as string,
        new_password: body.new_password as string,
      },
    });
    if (!updateResponse.ok) {
      if (updateResponse.error.response.status === 400) {
        const modelResponse: ApiDocsBadRequestResponse =
          await updateResponse.error.response.json();
        return {
          fieldErrors: {
            old_password: modelResponse.error_fields?.old_password as string,
            new_password: modelResponse.error_fields?.new_password as string,
          },
          success: false,
        };
      } else if (updateResponse.error.response.status === 403) {
        return {
          success: false,
          message: 'You do not have enough permissions to update password',
        };
      }
      throw updateResponse.error;
    }

    return {
      success: true,
    };
  } else if (_actionType === ActionEnumType.INVITE_USER) {
    const body = Object.fromEntries(formData);
    const role = body.role as keyof typeof ModelUpdateUserIdRequestRoleEnum;
    const _role: ModelUpdateUserIdRequestRoleEnum =
      ModelUpdateUserIdRequestRoleEnum[role];

    const inviteApi = apiWrapper({
      fn: getUserApiClient().inviteUser,
    });
    const inviteResponse = await inviteApi({
      modelInviteUserRequest: {
        action: body.intent as ModelInviteUserRequestActionEnum,
        email: body.email as string,
        role: _role,
      },
    });
    if (!inviteResponse.ok) {
      if (inviteResponse.error.response.status === 400) {
        return {
          success: false,
          message: inviteResponse.error.message,
        };
      } else if (inviteResponse.error.response.status === 403) {
        return {
          success: false,
          message: 'You do not have enough permissions to invite user',
        };
      }
      throw inviteResponse.error;
    }

    if (body.intent == ModelInviteUserRequestActionEnum.GetInviteLink) {
      inviteResponse.value.invite_url &&
        navigator.clipboard.writeText(inviteResponse.value.invite_url);
      toast.success('User invite URL copied !');
      return { ...inviteResponse.value, success: true };
    } else if (body.intent === ModelInviteUserRequestActionEnum.SendInviteEmail) {
      return { successMessage: 'User invite sent successfully', success: true };
    }

    return {
      success: true,
    };
  } else if (_actionType === ActionEnumType.EDIT_USER) {
    const body = Object.fromEntries(formData);

    const role = body.role as keyof typeof ModelUpdateUserIdRequestRoleEnum;
    const _role: ModelUpdateUserIdRequestRoleEnum =
      ModelUpdateUserIdRequestRoleEnum[role];

    const updateApi = apiWrapper({
      fn: getUserApiClient().updateUser,
    });
    const updateResponse = await updateApi({
      id: Number(body.id),
      modelUpdateUserIdRequest: {
        first_name: body.firstName as string,
        last_name: body.lastName as string,
        role: _role,
        is_active: body.status === 'Active',
      },
    });
    if (!updateResponse.ok) {
      if (updateResponse.error.response.status === 400) {
        const modelResponse: ApiDocsBadRequestResponse =
          await updateResponse.error.response.json();
        return {
          fieldErrors: {
            firstName: modelResponse.error_fields?.first_name as string,
            lastName: modelResponse.error_fields?.last_name as string,
            status: modelResponse.error_fields?.is_active as string,
            role: modelResponse.error_fields?.role as string,
          },
          success: false,
        };
      } else if (updateResponse.error.response.status === 403) {
        return {
          success: false,
          message: 'You do not have enough permissions to update user',
        };
      }
      throw updateResponse.error;
    }

    return {
      success: true,
    };
  }
  invalidateQueries(queries.setting.listUsers._def);
  return {
    success: false,
  };
};
const ActionDropdown = ({
  user,
  trigger,
}: {
  user: ModelUser;
  trigger: React.ReactNode;
}) => {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showEditUserForm, setShowEditUserForm] = useState(false);

  return (
    <>
      {showDeleteDialog && user.id && (
        <DeleteConfirmationModal
          showDialog={showDeleteDialog}
          userId={user.id}
          setShowDialog={setShowDeleteDialog}
        />
      )}
      {showEditUserForm && (
        <EditUserModal
          showDialog={showEditUserForm}
          user={user}
          setShowDialog={setShowEditUserForm}
        />
      )}
      <Dropdown
        triggerAsChild={true}
        align="start"
        content={
          <>
            <DropdownItem
              onClick={() => {
                setShowEditUserForm(true);
              }}
            >
              Edit
            </DropdownItem>
            <DropdownItem
              onClick={() => {
                setShowDeleteDialog(true);
              }}
            >
              Delete
            </DropdownItem>
          </>
        }
      >
        {trigger}
      </Dropdown>
    </>
  );
};

const ChangePasswordModal = ({
  showDialog,
  setShowDialog,
}: {
  showDialog: boolean;
  setShowDialog: React.Dispatch<React.SetStateAction<boolean>>;
}) => {
  return (
    <Modal
      open={showDialog}
      onOpenChange={() => setShowDialog(false)}
      title="Change Password"
    >
      <ChangePassword />
    </Modal>
  );
};
const InviteUserModal = ({
  showDialog,
  setShowDialog,
}: {
  showDialog: boolean;
  setShowDialog: React.Dispatch<React.SetStateAction<boolean>>;
}) => {
  const fetcher = useFetcher<ActionReturnType>();
  const { data, state } = fetcher;
  const [_role, _setRole] = useState('');

  return (
    <SlidingModal size="s" open={showDialog} onOpenChange={() => setShowDialog(false)}>
      <SlidingModalHeader>
        <div className="text-h3 dark:text-text-text-and-icon py-4 px-4 dark:bg-bg-breadcrumb-bar">
          Invite user
        </div>
      </SlidingModalHeader>
      <SlidingModalCloseButton />
      <SlidingModalContent>
        {data?.success && data?.successMessage ? (
          <SuccessModalContent text={data?.successMessage}>
            {data?.invite_url && (
              <p className={`my-4 text-p7 dark:text-status-success`}>
                {data?.invite_url} , invite will expire after {data?.invite_expiry_hours}{' '}
                hours
              </p>
            )}
          </SuccessModalContent>
        ) : (
          <fetcher.Form method="post" className="flex flex-col gap-y-8 mt-4 mx-4">
            <TextInput
              label="Email"
              type={'email'}
              placeholder="Email"
              name="email"
              color={data?.fieldErrors?.email ? 'error' : 'default'}
              required
              helperText={data?.fieldErrors?.email}
            />
            <Listbox
              variant="underline"
              value={_role}
              name="role"
              label={'Role'}
              placeholder="Role"
              helperText={data?.fieldErrors?.role}
              onChange={(item: string) => {
                _setRole(item);
              }}
              getDisplayValue={() => {
                return Object.keys(ModelUpdateUserIdRequestRoleEnum).filter((item) => {
                  return item === _role;
                })[0];
              }}
            >
              {Object.keys(ModelUpdateUserIdRequestRoleEnum).map((role) => {
                return (
                  <ListboxOption value={role} key={role}>
                    {role}
                  </ListboxOption>
                );
              })}
            </Listbox>

            {!data?.success && data?.message && (
              <div className={`dark:text-status-error text-p7`}>
                <span>{data?.message}</span>
              </div>
            )}
            <div className="flex items-center gap-x-2">
              <Button
                size="sm"
                type="submit"
                name="intent"
                value={ModelInviteUserRequestActionEnum['SendInviteEmail']}
              >
                Send invite via email
              </Button>

              <input
                type="text"
                name="_actionType"
                hidden
                readOnly
                value={ActionEnumType.INVITE_USER}
              />

              <Button
                variant="outline"
                type="submit"
                size="sm"
                name="intent"
                value={ModelInviteUserRequestActionEnum['GetInviteLink']}
              >
                Copy invite link
              </Button>
            </div>
            {data?.invite_url && (
              <p className={`mt-1.5 font-normal text-center text-sm text-green-500`}>
                Invite URL: {data?.invite_url}, invite will expire after{' '}
                {data?.invite_expiry_hours} hours
              </p>
            )}
          </fetcher.Form>
        )}
      </SlidingModalContent>
    </SlidingModal>
  );
};

const EditUserModal = ({
  showDialog,
  user,
  setShowDialog,
}: {
  showDialog: boolean;
  user: ModelUser;
  setShowDialog: React.Dispatch<React.SetStateAction<boolean>>;
}) => {
  const fetcher = useFetcher<ActionReturnType>();
  const { data } = fetcher;

  const role = Object.entries(ModelUpdateUserIdRequestRoleEnum).find(
    ([_, val]) => val === user.role,
  )?.[0];
  const [_role, _setRole] = useState('');
  const [_status, _setStatus] = useState('');

  return (
    <SlidingModal size="s" open={showDialog} onOpenChange={() => setShowDialog(false)}>
      <SlidingModalHeader>
        <div className="text-h3 dark:text-text-text-and-icon py-4 px-4 dark:bg-bg-breadcrumb-bar">
          Update user
        </div>
      </SlidingModalHeader>
      <SlidingModalCloseButton />
      <SlidingModalContent>
        {!data?.success ? (
          <fetcher.Form method="post" className="flex flex-col gap-y-8 mt-4 mx-4">
            <input readOnly type="hidden" name="id" value={user?.id} />
            <input
              readOnly
              type="hidden"
              name="_actionType"
              value={ActionEnumType.EDIT_USER}
            />
            <TextInput
              label="First Name"
              type={'text'}
              placeholder="First Name"
              name="firstName"
              color={data?.fieldErrors?.firstName ? 'error' : 'default'}
              defaultValue={user?.first_name}
              helperText={data?.fieldErrors?.firstName}
              required
            />
            <TextInput
              label="Last Name"
              type={'text'}
              placeholder="Last Name"
              name="lastName"
              color={data?.fieldErrors?.lastName ? 'error' : 'default'}
              defaultValue={user?.last_name}
              helperText={data?.fieldErrors?.lastName}
              required
            />
            <Listbox
              variant="underline"
              value={_role}
              defaultValue={role}
              name="role"
              label={'Role'}
              placeholder="Role"
              helperText={data?.fieldErrors?.role}
              onChange={(item) => {
                _setRole(item);
              }}
              getDisplayValue={() => {
                return Object.keys(ModelUpdateUserIdRequestRoleEnum).filter((item) => {
                  return item === _role;
                })[0];
              }}
            >
              {Object.keys(ModelUpdateUserIdRequestRoleEnum).map((role) => {
                return (
                  <ListboxOption value={role} key={role}>
                    {role}
                  </ListboxOption>
                );
              })}
            </Listbox>
            <Listbox
              variant="underline"
              value={status}
              name="status"
              label={'Status'}
              placeholder="Active"
              defaultValue={user?.is_active ? 'Active' : 'inActive'}
              helperText={data?.fieldErrors?.status}
              onChange={(item) => {
                _setStatus(item);
              }}
              getDisplayValue={() => {
                return ['Active', 'Inactive'].filter((item) => {
                  return item === _status;
                })[0];
              }}
            >
              <ListboxOption value="Active">Active</ListboxOption>
              <ListboxOption value="InActive">Inactive</ListboxOption>
            </Listbox>
            {!data?.success && data?.message && (
              <p className="dark:text-status-error text-p7">{data.message}</p>
            )}

            <div className="flex gap-x-2 mt-9">
              <Button type="submit">Update</Button>
              <Button
                variant="outline"
                type="button"
                onClick={() => setShowDialog(false)}
              >
                Cancel
              </Button>
            </div>
          </fetcher.Form>
        ) : (
          <SuccessModalContent text="User details successfully updated!" />
        )}
      </SlidingModalContent>
    </SlidingModal>
  );
};

const APITokenSkeletonComponent = () => {
  return (
    <div className="flex flex-col gap-y-4 animate-pulse min-w-[400px]">
      <div className="h-10 w-72 bg-gray-200 dark:bg-gray-700 py-4 rounded-md"></div>
      <div className="flex gap-x-[140px]">
        <div className="h-5 w-16 bg-gray-200 dark:bg-gray-700 rounded-md"></div>
        <div className="h-5 w-56 bg-gray-200 dark:bg-gray-700 rounded-md"></div>
      </div>
      <div className="flex gap-x-[140px]">
        <div className="h-5 w-16 bg-gray-200 dark:bg-gray-700 rounded-md"></div>
        <div className="h-5 w-56 bg-gray-200 dark:bg-gray-700 rounded-md"></div>
      </div>
      <div className="flex gap-x-[140px]">
        <div className="h-5 w-16 bg-gray-200 dark:bg-gray-700 rounded-md"></div>
        <div className="h-5 w-56 bg-gray-200 dark:bg-gray-700 rounded-md"></div>
      </div>
      <div className="flex gap-x-[140px]">
        <div className="h-5 w-16 bg-gray-200 dark:bg-gray-700 rounded-md"></div>
        <div className="h-5 w-56 bg-gray-200 dark:bg-gray-700 rounded-md"></div>
      </div>
    </div>
  );
};
const APITokenComponent = () => {
  const { data } = useGetApiToken();
  const { status: currentUserStatus = 'dummy', data: currentUserData } =
    useGetCurrentUser();
  const [showApikey, setShowApiKey] = useState(false);
  const [openChangePasswordForm, setOpenChangePasswordForm] = useState(false);

  const { copy, isCopied } = useCopyToClipboardState();

  return (
    <div className="text-gray-600 dark:text-white rounded-lg w-full">
      <ChangePasswordModal
        showDialog={openChangePasswordForm}
        setShowDialog={setOpenChangePasswordForm}
      />

      {currentUserStatus !== 'idle' && !data ? (
        <APITokenSkeletonComponent />
      ) : (
        <div>
          <div className="flex">
            <div className="flex flex-col">
              <span className="text-2xl dark:text-gray-100 font-semibold">
                {`${currentUserData?.first_name || ''} ${
                  currentUserData?.last_name || ''
                }`}
              </span>
              <span
                className={twMerge(
                  cx(
                    'font-semibold w-fit text-xs rounded-sm dark:text-gray-100 self-start',
                    {
                      'text-green-500 dark:text-status-success':
                        currentUserData?.is_active,
                      'text-gray-700 dark:text-df-gray-400': !currentUserData?.is_active,
                    },
                  ),
                )}
              >
                {currentUserData?.is_active ? 'Active' : 'Inactive'}
              </span>
            </div>
          </div>
          <div className="flex mt-4 mb-2">
            <span className="text-p7 flex items-center gap-x-1 min-w-[140px] dark:text-text-text-and-icon">
              <IconContext.Provider
                value={{
                  className: 'w-4 h-4',
                }}
              >
                <HiOutlineMail />
              </IconContext.Provider>
              Email
            </span>
            <span className="text-p4 dark:text-text-input-value">
              {currentUserData?.email || '-'}
            </span>
          </div>
          <div className="flex my-3">
            <span className="text-p7 flex items-center gap-x-1 min-w-[140px] dark:text-text-text-and-icon">
              <IconContext.Provider
                value={{
                  className: 'w-4 h-4',
                }}
              >
                <HiOutlineSupport />
              </IconContext.Provider>
              Company
            </span>
            <span className="text-p4 dark:text-text-input-value">
              {currentUserData?.company || '-'}
            </span>
          </div>
          <div className="flex my-3">
            <span className="text-p7 flex items-center gap-x-1 min-w-[140px] dark:text-text-text-and-icon">
              <IconContext.Provider
                value={{
                  className: 'w-4 h-4',
                }}
              >
                <HiOutlineUser />
              </IconContext.Provider>
              Role
            </span>
            <span className="text-p4 dark:text-text-input-value">
              {currentUserData?.role || '-'}
            </span>
          </div>
          <div className="flex my-3">
            <span className="text-p7 flex items-center gap-x-1 min-w-[140px] dark:text-text-text-and-icon">
              <IconContext.Provider
                value={{
                  className: 'w-4 h-4',
                }}
              >
                <HiOutlineKey />
              </IconContext.Provider>
              Api key
            </span>
            <div className="text-p4 items-center dark:text-text-input-value flex gap-x-2">
              <span className="font-mono">
                {showApikey
                  ? data?.api_token || '-'
                  : '************************************'}
              </span>
              <div className="flex ml-2">
                {!showApikey ? (
                  <IconButton
                    icon={<HiOutlineEye />}
                    variant="flat"
                    onClick={() => {
                      setShowApiKey(true);
                    }}
                  />
                ) : (
                  <IconButton
                    icon={<HiOutlineEyeOff />}
                    variant="flat"
                    onClick={() => {
                      setShowApiKey(false);
                    }}
                  />
                )}
                <div className="relative top-0 right-0 ml-2">
                  {isCopied ? (
                    <HiCheck />
                  ) : (
                    <IconButton
                      icon={<MdCopyAll />}
                      variant="flat"
                      onClick={() => copy(data?.api_token ?? '')}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
          <Button size="sm" className="" onClick={() => setOpenChangePasswordForm(true)}>
            Change Password
          </Button>
        </div>
      )}
    </div>
  );
};

const UsersTable = () => {
  const columnHelper = createColumnHelper<ModelUser>();
  const columns = useMemo(() => {
    const columns = [
      columnHelper.display({
        id: 'actions',
        enableSorting: false,
        cell: (cell) => {
          if (!cell.row.original.id) {
            throw new Error('User id not found');
          }
          return (
            <ActionDropdown
              user={cell.row.original}
              trigger={
                <button className="p-1">
                  <div className="h-[16px] w-[16px] dark:text-text-text-and-icon rotate-90">
                    <EllipsisIcon />
                  </div>
                </button>
              }
            />
          );
        },
        header: () => '',
        minSize: 20,
        size: 20,
        maxSize: 20,
        enableResizing: false,
      }),
      columnHelper.accessor('id', {
        cell: (cell) => cell.getValue(),
        header: () => 'ID',
        minSize: 30,
        size: 30,
        maxSize: 85,
      }),
      columnHelper.accessor('first_name', {
        cell: (cell) => cell.getValue(),
        header: () => 'First Name',
        minSize: 30,
        size: 80,
        maxSize: 85,
      }),
      columnHelper.accessor('last_name', {
        cell: (cell) => cell.getValue(),
        header: () => 'Last Name',
        minSize: 30,
        size: 80,
        maxSize: 85,
      }),
      columnHelper.accessor('email', {
        cell: (cell) => cell.getValue(),
        header: () => 'Email',
        minSize: 30,
        size: 80,
        maxSize: 85,
      }),
      columnHelper.accessor('role', {
        cell: (cell) => cell.getValue(),
        header: () => 'Role',
        minSize: 30,
        size: 80,
        maxSize: 85,
      }),
    ];
    return columns;
  }, []);
  const { data } = useListUsers();
  const [pageSize, setPageSize] = useState(10);

  if (data.message) {
    return <p className="dark:text-status-error text-p7">{data.message}</p>;
  }
  return (
    <div className="mt-4">
      <Table
        pageSize={pageSize}
        size="compact"
        data={data.data ?? []}
        columns={columns}
        enableColumnResizing
        enableSorting
        enablePagination
        enablePageResize
        onPageResize={(newSize) => {
          setPageSize(newSize);
        }}
      />
    </div>
  );
};
const UserManagement = () => {
  const [openInviteUserForm, setOpenInviteUserForm] = useState(false);

  return (
    <div className="h-full mt-2">
      <APITokenComponent />
      {openInviteUserForm && (
        <InviteUserModal
          showDialog={openInviteUserForm}
          setShowDialog={setOpenInviteUserForm}
        />
      )}
      <div className="mt-8">
        <div className="mt-2 flex gap-x-2 items-center">
          <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900 bg-opacity-75 dark:bg-opacity-50 flex items-center justify-center rounded-sm">
            <IconContext.Provider
              value={{
                className: 'text-blue-600 dark:text-blue-400',
              }}
            >
              <HiUsers />
            </IconContext.Provider>
          </div>
          <h3 className="text-h6 dark:text-text-text-and-icon">User Accounts</h3>
        </div>
        <Button
          size="sm"
          startIcon={<FaUserPlus />}
          type="button"
          className="mt-2"
          onClick={() => setOpenInviteUserForm(true)}
        >
          Invite User
        </Button>
        <Suspense
          fallback={
            <TableSkeleton columns={6} rows={5} size={'compact'} className="mt-2" />
          }
        >
          <UsersTable />
        </Suspense>
      </div>
    </div>
  );
};

export const module = {
  element: <UserManagement />,
  action,
};

const DeleteConfirmationModal = ({
  showDialog,
  userId,
  setShowDialog,
}: {
  showDialog: boolean;
  userId: number;
  setShowDialog: React.Dispatch<React.SetStateAction<boolean>>;
}) => {
  const fetcher = useFetcher();

  const onDeleteAction = useCallback(() => {
    const formData = new FormData();
    formData.append('_actionType', ActionEnumType.DELETE);
    formData.append('userId', userId.toString());
    fetcher.submit(formData, {
      method: 'post',
    });
  }, [userId, fetcher]);
  return (
    <Modal
      size="s"
      open={showDialog}
      onOpenChange={() => setShowDialog(false)}
      title={
        !fetcher.data?.success ? (
          <div className="flex gap-3 items-center dark:text-status-error">
            <span className="h-6 w-6 shrink-0">
              <ErrorStandardLineIcon />
            </span>
            Delete user
          </div>
        ) : undefined
      }
      footer={
        !fetcher.data?.success ? (
          <div className={'flex gap-x-4 justify-end'}>
            <Button
              color="error"
              type="submit"
              onClick={(e) => {
                e.preventDefault();
                onDeleteAction();
              }}
            >
              Yes, I&apos;m sure
            </Button>
            <Button onClick={() => setShowDialog(false)} type="button" variant="outline">
              Cancel
            </Button>
          </div>
        ) : undefined
      }
    >
      {!fetcher.data?.success ? (
        <div className="grid">
          <span>The selected user will be deleted.</span>
          <br />
          <span>Are you sure you want to delete?</span>
          {fetcher.data?.message && <p className="">{fetcher.data?.message}</p>}
          <div className="flex items-center justify-right gap-4"></div>
        </div>
      ) : (
        <SuccessModalContent text="Deleted successfully" />
      )}
    </Modal>
  );
};
