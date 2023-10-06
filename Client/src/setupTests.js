// This setup file will automatically run by react-scripts test.
import { setIconOptions } from "@fluentui/react/lib/Styling";
import Enzyme from "enzyme";
import Adapter from "@wojtekmaj/enzyme-adapter-react-17";

Enzyme.configure({ adapter: new Adapter() });
process.env.REACT_APP_SERVER_SITE_URL = "https://evisa.terado.vn/api";

// Suppress icon warnings.
setIconOptions({
    disableWarnings: true,
});
