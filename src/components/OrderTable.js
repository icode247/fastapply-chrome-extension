/* eslint-disable jsx-a11y/anchor-is-valid */
import * as React from "react";
import Avatar from "@mui/joy/Avatar";
import Box from "@mui/joy/Box";
import Button from "@mui/joy/Button";
import Chip from "@mui/joy/Chip";
import Divider from "@mui/joy/Divider";
import FormControl from "@mui/joy/FormControl";
import FormLabel from "@mui/joy/FormLabel";
import Link from "@mui/joy/Link";
import Input from "@mui/joy/Input";
import Modal from "@mui/joy/Modal";
import ModalDialog from "@mui/joy/ModalDialog";
import ModalClose from "@mui/joy/ModalClose";
import Select from "@mui/joy/Select";
import Option from "@mui/joy/Option";
import Table from "@mui/joy/Table";
import Sheet from "@mui/joy/Sheet";
import Checkbox from "@mui/joy/Checkbox";
import IconButton, { iconButtonClasses } from "@mui/joy/IconButton";
import Typography from "@mui/joy/Typography";
import Menu from "@mui/joy/Menu";
import MenuButton from "@mui/joy/MenuButton";
import MenuItem from "@mui/joy/MenuItem";
import Dropdown from "@mui/joy/Dropdown";
import FilterAltIcon from "@mui/icons-material/FilterAlt";
import SearchIcon from "@mui/icons-material/Search";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import BlockIcon from "@mui/icons-material/Block";
import AutorenewRoundedIcon from "@mui/icons-material/AutorenewRounded";
import MoreHorizRoundedIcon from "@mui/icons-material/MoreHorizRounded";

const jobRows = [
  {
    id: "4036622211",
    appliedDate: "Oct 1, 2024",
    status: "Applied",
    jobDetails: {
      position: "Frontend Developer",
      // company: "Google",
      location: "Mountain View, CA",
    },
    recruiter: {
      initial: "J",
      name: "Google",
      // email: 'john.doe@linkedin.com',
    },
  },
  {
    id: "4036621679",
    appliedDate: "Sep 30, 2024",
    status: "Interview",
    jobDetails: {
      position: "Software Engineer",
      // company: "LinkedIn",
      location: "Remote",
    },
    recruiter: {
      initial: "M",
      name: "Wazobia Technologies",
      // email: 'mary.smith@google.com',
    },
  },
  // Add more job application rows here
];

function descendingComparator(a, b, orderBy) {
  if (b[orderBy] < a[orderBy]) {
    return -1;
  }
  if (b[orderBy] > a[orderBy]) {
    return 1;
  }
  return 0;
}

function getComparator(order, orderBy) {
  return order === "desc"
    ? (a, b) => descendingComparator(a, b, orderBy)
    : (a, b) => -descendingComparator(a, b, orderBy);
}

function RowMenu() {
  return (
    <Dropdown>
      <MenuButton
        slots={{ root: IconButton }}
        slotProps={{ root: { variant: "plain", color: "neutral", size: "sm" } }}
      >
        <MoreHorizRoundedIcon />
      </MenuButton>
      <Menu size="sm" sx={{ minWidth: 140 }}>
        <MenuItem>View Details</MenuItem>
        <Divider />
        <MenuItem color="danger">Remove</MenuItem>
      </Menu>
    </Dropdown>
  );
}

export default function JobTable() {
  const [order, setOrder] = React.useState("desc");
  const [selected, setSelected] = React.useState([]);
  const [open, setOpen] = React.useState(false);

  const renderFilters = () => (
    <React.Fragment>
      <FormControl size="sm">
        <FormLabel>Status</FormLabel>
        <Select
          size="sm"
          placeholder="Filter by status"
          slotProps={{ button: { sx: { whiteSpace: "nowrap" } } }}
        >
          <Option value="applied">Applied</Option>
          <Option value="interview">Interview</Option>
          <Option value="offer">Offer</Option>
          <Option value="rejected">Rejected</Option>
        </Select>
      </FormControl>
      <FormControl size="sm">
        <FormLabel>Company</FormLabel>
        <Select size="sm" placeholder="All Companies">
          <Option value="linkedin">LinkedIn</Option>
          <Option value="google">Google</Option>
          {/* Add more options as needed */}
        </Select>
      </FormControl>
    </React.Fragment>
  );

  return (
    <React.Fragment>
      <Sheet
        className="SearchAndFilters-mobile"
        sx={{ display: { xs: "flex", sm: "none" }, my: 1, gap: 1 }}
      >
        <Input
          size="sm"
          placeholder="Search"
          startDecorator={<SearchIcon />}
          sx={{ flexGrow: 1 }}
        />
        <IconButton
          size="sm"
          variant="outlined"
          color="neutral"
          onClick={() => setOpen(true)}
        >
          <FilterAltIcon />
        </IconButton>
        <Modal open={open} onClose={() => setOpen(false)}>
          <ModalDialog aria-labelledby="filter-modal" layout="fullscreen">
            <ModalClose />
            <Typography id="filter-modal" level="h2">
              Filters
            </Typography>
            <Divider sx={{ my: 2 }} />
            <Sheet sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {renderFilters()}
              <Button color="primary" onClick={() => setOpen(false)}>
                Submit
              </Button>
            </Sheet>
          </ModalDialog>
        </Modal>
      </Sheet>
      <Box
        className="SearchAndFilters-tabletUp"
        sx={{
          borderRadius: "sm",
          py: 2,
          display: { xs: "none", sm: "flex" },
          flexWrap: "wrap",
          gap: 1.5,
          "& > *": {
            minWidth: { xs: "120px", md: "160px" },
          },
        }}
      >
        <FormControl sx={{ flex: 1 }} size="sm">
          <FormLabel>Search for job applications</FormLabel>
          <Input
            size="sm"
            placeholder="Search"
            startDecorator={<SearchIcon />}
          />
        </FormControl>
        {renderFilters()}
      </Box>
      <Sheet
        className="JobTableContainer"
        variant="outlined"
        sx={{
          display: { xs: "none", sm: "initial" },
          width: "100%",
          borderRadius: "sm",
          flexShrink: 1,
          overflow: "auto",
          minHeight: 0,
        }}
      >
        <Table
          aria-labelledby="tableTitle"
          stickyHeader
          hoverRow
          sx={{
            "--TableCell-headBackground":
              "var(--joy-palette-background-level1)",
            "--Table-headerUnderlineThickness": "1px",
            "--TableRow-hoverBackground":
              "var(--joy-palette-background-level1)",
            "--TableCell-paddingY": "4px",
            "--TableCell-paddingX": "8px",
          }}
        >
          <thead>
            <tr>
              <th
                style={{ width: 48, textAlign: "center", padding: "12px 6px" }}
              >
                <Checkbox
                  size="sm"
                  indeterminate={
                    selected.length > 0 && selected.length !== jobRows.length
                  }
                  checked={selected.length === jobRows.length}
                  onChange={(event) => {
                    setSelected(
                      event.target.checked ? jobRows.map((row) => row.id) : []
                    );
                  }}
                  color={
                    selected.length > 0 || selected.length === jobRows.length
                      ? "primary"
                      : undefined
                  }
                  sx={{ verticalAlign: "text-bottom" }}
                />
              </th>
              <th style={{ width: 120, padding: "12px 6px" }}>
                <Link
                  underline="none"
                  color="primary"
                  component="button"
                  onClick={() => setOrder(order === "asc" ? "desc" : "asc")}
                  endDecorator={<ArrowDropDownIcon />}
                  sx={[
                    {
                      fontWeight: "lg",
                      "& svg": {
                        transition: "0.2s",
                        transform:
                          order === "desc" ? "rotate(0deg)" : "rotate(180deg)",
                      },
                    },
                    order === "desc"
                      ? { "& svg": { transform: "rotate(0deg)" } }
                      : { "& svg": { transform: "rotate(180deg)" } },
                  ]}
                >
                  Job ID
                </Link>
              </th>
              <th style={{ width: 140, padding: "12px 6px" }}>Applied Date</th>
              <th style={{ width: 140, padding: "12px 6px" }}>Status</th>
              <th style={{ width: 240, padding: "12px 6px" }}>Job Details</th>
              <th style={{ width: 240, padding: "12px 6px" }}>Recruiter</th>
              <th
                style={{ width: 48, textAlign: "center", padding: "12px 6px" }}
              />
            </tr>
          </thead>
          <tbody>
            {jobRows.map((row) => (
              <tr key={row.id}>
                <td style={{ textAlign: "center" }}>
                  <Checkbox
                    size="sm"
                    checked={selected.includes(row.id)}
                    onChange={(event) =>
                      setSelected((prev) =>
                        event.target.checked
                          ? [...prev, row.id]
                          : prev.filter((id) => id !== row.id)
                      )
                    }
                    color={selected.includes(row.id) ? "primary" : undefined}
                    sx={{ verticalAlign: "text-bottom" }}
                  />
                </td>
                <td>{row.id}</td>
                <td>{row.appliedDate}</td>
                <td>
                  <Chip
                    size="sm"
                    variant="soft"
                    startDecorator={
                      {
                        Applied: <AutorenewRoundedIcon />,
                        Interview: <CheckRoundedIcon />,
                        Offer: <CheckRoundedIcon />,
                        Rejected: <BlockIcon />,
                      }[row.status]
                    }
                    color={
                      {
                        Applied: "neutral",
                        Interview: "warning",
                        Offer: "success",
                        Rejected: "danger",
                      }[row.status]
                    }
                  >
                    {row.status}
                  </Chip>
                </td>
                <td>
                  <Box sx={{ display: "flex", flexDirection: "column" }}>
                    <Typography fontWeight="md" textColor="text.primary">
                      {row.jobDetails.position}
                    </Typography>
                    <Typography level="body2">
                      {row.jobDetails.company}
                    </Typography>
                    <Typography level="body2">
                      {row.jobDetails.location}
                    </Typography>
                  </Box>
                </td>
                <td>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Avatar size="sm">{row.recruiter.initial}</Avatar>
                    <Box sx={{ display: "flex", flexDirection: "column" }}>
                      <Typography fontWeight="md" textColor="text.primary">
                        {row.recruiter.name}
                      </Typography>
                      <Typography level="body2">
                        {row.recruiter.email}
                      </Typography>
                    </Box>
                  </Box>
                </td>
                <td>
                  <RowMenu />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Sheet>
    </React.Fragment>
  );
}
